import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function withStatus(user: {
  isActive: boolean
  subscriptionEnd: Date | null
  subscriptionStart: Date | null
}) {
  const now = new Date()
  const end = user.subscriptionEnd ? new Date(user.subscriptionEnd) : null
  const start = user.subscriptionStart ? new Date(user.subscriptionStart) : null
  let status: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED'
  if (!user.isActive) {
    status = 'SUSPENDED'
  } else if (!end || end < now) {
    status = 'EXPIRED'
  } else if ((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24) <= 30) {
    status = 'EXPIRING'
  } else if (start && start > now) {
    status = 'SUSPENDED'
  } else {
    status = 'ACTIVE'
  }
  return { status, daysLeft: end ? Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null }
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }

    const admins = await db.user.findMany({
      where: { role: 'BUILDING_ADMIN' },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        isActive: true,
        createdAt: true,
        buildingId: true,
        building: { select: { id: true, name: true, city: true } },
        subscriptionStart: true,
        subscriptionEnd: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ admins: admins.map(a => ({ ...a, ...withStatus(a) })) })
  } catch (error) {
    console.error('BuildingAdmins GET error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }

    const body = await request.json()
    const { name, email, password, phone, buildingId, durationMonths } = body

    if (!name || !email || !password || !buildingId) {
      return NextResponse.json(
        { error: 'Nom, email, mot de passe et immeuble sont requis' },
        { status: 400 }
      )
    }

    const duration = Number(durationMonths) || 12
    if (duration <= 0 || duration > 60) {
      return NextResponse.json({ error: 'Durée d\'abonnement invalide (1 à 60 mois)' }, { status: 400 })
    }

    const existingUser = await db.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json({ error: 'Cet email est déjà utilisé' }, { status: 400 })
    }

    const building = await db.building.findUnique({ where: { id: buildingId } })
    if (!building) {
      return NextResponse.json({ error: 'Immeuble introuvable' }, { status: 404 })
    }

    // Only one admin account per building
    const existingAdmin = await db.user.findFirst({
      where: { role: 'BUILDING_ADMIN', buildingId },
    })
    if (existingAdmin) {
      return NextResponse.json(
        { error: `Un compte d'administration existe déjà pour cet immeuble (${existingAdmin.email})` },
        { status: 400 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const subscriptionStart = new Date()
    const subscriptionEnd = addMonths(subscriptionStart, duration)

    const user = await db.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        phone: phone || null,
        role: 'BUILDING_ADMIN',
        isActive: true,
        buildingId,
        subscriptionStart,
        subscriptionEnd,
      },
    })

    await db.notification.create({
      data: {
        userId: user.id,
        title: 'Compte administrateur créé',
        message: `Votre compte d'administration pour l'immeuble ${building.name} a été créé. Abonnement valable jusqu'au ${subscriptionEnd.toLocaleDateString('fr-FR')}.`,
        type: 'ACCOUNT',
      },
    })

    return NextResponse.json({
      admin: {
        ...user,
        password: undefined,
        building: { id: building.id, name: building.name, city: building.city },
        ...withStatus(user),
      },
    })
  } catch (error) {
    console.error('BuildingAdmins POST error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }

    const body = await request.json()
    const { id, isActive, renewMonths, subscriptionEnd, name, phone } = body

    if (!id) {
      return NextResponse.json({ error: 'ID requis' }, { status: 400 })
    }

    const admin = await db.user.findFirst({
      where: { id, role: 'BUILDING_ADMIN' },
    })
    if (!admin) {
      return NextResponse.json({ error: 'Compte administrateur introuvable' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (phone !== undefined) updateData.phone = phone

    // Toggle active (suspend / reactivate)
    if (isActive !== undefined) updateData.isActive = isActive

    // Renew: extend from the later of (today, current end date)
    if (renewMonths !== undefined) {
      const months = Number(renewMonths)
      if (months <= 0 || months > 60) {
        return NextResponse.json({ error: 'Durée de renouvellement invalide (1 à 60 mois)' }, { status: 400 })
      }
      const base =
        admin.subscriptionEnd && new Date(admin.subscriptionEnd) > new Date()
          ? new Date(admin.subscriptionEnd)
          : new Date()
      updateData.subscriptionEnd = addMonths(base, months)
      if (!admin.subscriptionStart) updateData.subscriptionStart = new Date()
    }

    // Custom end date
    if (subscriptionEnd !== undefined) {
      const d = new Date(subscriptionEnd)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Date d\'expiration invalide' }, { status: 400 })
      }
      d.setHours(23, 59, 59, 999)
      updateData.subscriptionEnd = d
      if (!admin.subscriptionStart) updateData.subscriptionStart = new Date()
    }

    const updated = await db.user.update({
      where: { id },
      data: updateData,
      include: { building: { select: { id: true, name: true, city: true } } },
    })

    // Notify the building admin about renewal / suspension
    if (renewMonths !== undefined || subscriptionEnd !== undefined || isActive !== undefined) {
      await db.notification.create({
        data: {
          userId: id,
          title:
            renewMonths !== undefined || subscriptionEnd !== undefined
              ? 'Abonnement renouvelé'
              : isActive
                ? 'Compte activé'
                : 'Compte suspendu',
          message:
            renewMonths !== undefined || subscriptionEnd !== undefined
              ? `Votre abonnement a été renouvelé jusqu'au ${new Date(updateData.subscriptionEnd as Date).toLocaleDateString('fr-FR')}.`
              : isActive
                ? 'Votre compte a été réactivé par l\'administrateur.'
                : 'Votre compte a été suspendu. Contactez l\'administrateur.',
          type: 'ACCOUNT',
        },
      })
    }

    return NextResponse.json({
      admin: {
        ...updated,
        password: undefined,
        ...withStatus(updated),
      },
    })
  } catch (error) {
    console.error('BuildingAdmins PUT error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID requis' }, { status: 400 })
    }

    const admin = await db.user.findFirst({
      where: { id, role: 'BUILDING_ADMIN' },
    })
    if (!admin) {
      return NextResponse.json({ error: 'Compte administrateur introuvable' }, { status: 404 })
    }

    await db.user.delete({ where: { id } })
    return NextResponse.json({ message: 'Compte administrateur supprimé avec succès' })
  } catch (error) {
    console.error('BuildingAdmins DELETE error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
