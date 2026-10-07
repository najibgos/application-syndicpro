import { NextRequest, NextResponse } from 'next/server'
import { getSession, getAdminScope, subscriptionExpiredResponse } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    // Building admin: only their building's apartments
    let scopedBuildingId: string | null = null
    if (session.role === 'BUILDING_ADMIN') {
      const scope = await getAdminScope(session)
      scopedBuildingId = scope?.buildingId || 'none'
    }

    const apartments = await db.apartment.findMany({
      where: scopedBuildingId ? { buildingId: scopedBuildingId } : undefined,
      include: {
        building: true,
        owner: { select: { id: true, name: true, email: true, isActive: true } },
      },
      orderBy: [{ buildingId: 'asc' }, { number: 'asc' }],
    })

    return NextResponse.json({ apartments })
  } catch (error) {
    console.error('Apartments GET error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    const scope = await getAdminScope(session)
    if (!session || !scope?.isAdmin) {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }
    if (!scope.subscriptionActive) {
      return subscriptionExpiredResponse()
    }

    const body = await request.json()
    const { number, ownerName, monthlyFee, userId } = body

    // Building admin: force their own building
    const targetBuildingId = scope.buildingId || body.buildingId
    if (!number || !targetBuildingId || !ownerName) {
      return NextResponse.json({ error: 'Numéro, immeuble et nom du propriétaire sont requis' }, { status: 400 })
    }

    // Check for duplicate apartment number in the same building
    const existing = await db.apartment.findFirst({
      where: { number, buildingId: targetBuildingId },
    })
    if (existing) {
      return NextResponse.json({ error: `L'appartement N°${number} existe déjà dans cet immeuble` }, { status: 400 })
    }

    const apartment = await db.apartment.create({
      data: {
        number,
        buildingId: targetBuildingId,
        ownerName,
        monthlyFee: monthlyFee || 0,
        userId: userId || null,
      },
      include: { building: true },
    })

    return NextResponse.json({ apartment })
  } catch (error) {
    console.error('Apartments POST error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()
    const scope = await getAdminScope(session)
    if (!session || !scope?.isAdmin) {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }
    if (!scope.subscriptionActive) {
      return subscriptionExpiredResponse()
    }

    const body = await request.json()
    const { id, number, buildingId, ownerName, monthlyFee, userId } = body

    if (!id) {
      return NextResponse.json({ error: 'ID requis' }, { status: 400 })
    }

    // Building admin: apartment must belong to their building
    const current = await db.apartment.findUnique({ where: { id } })
    if (!current) {
      return NextResponse.json({ error: 'Appartement introuvable' }, { status: 404 })
    }
    if (scope.buildingId && current.buildingId !== scope.buildingId) {
      return NextResponse.json({ error: 'Accès non autorisé pour cet immeuble' }, { status: 403 })
    }

    // If number is being changed, check for duplicates (building cannot change for scoped admin)
    const checkBuilding = scope.buildingId || buildingId || current.buildingId
    if (number !== undefined) {
      const duplicate = await db.apartment.findFirst({
        where: { number, buildingId: checkBuilding, id: { not: id } },
      })
      if (duplicate) {
        return NextResponse.json({ error: `L'appartement N°${number} existe déjà dans cet immeuble` }, { status: 400 })
      }
    }

    const data: Record<string, unknown> = {}
    if (number !== undefined) data.number = number
    if (buildingId !== undefined && !scope.buildingId) data.buildingId = buildingId
    if (ownerName !== undefined) data.ownerName = ownerName
    if (monthlyFee !== undefined) data.monthlyFee = monthlyFee
    if (userId !== undefined) {
      data.userId = userId || null
    }

    const apartment = await db.apartment.update({
      where: { id },
      data,
      include: { building: true, owner: { select: { id: true, name: true, email: true, isActive: true } } },
    })

    return NextResponse.json({ apartment })
  } catch (error) {
    console.error('Apartments PUT error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    const scope = await getAdminScope(session)
    if (!session || !scope?.isAdmin) {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }
    if (!scope.subscriptionActive) {
      return subscriptionExpiredResponse()
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID requis' }, { status: 400 })
    }

    const existing = await db.apartment.findUnique({ where: { id } })
    if (scope.buildingId && existing?.buildingId !== scope.buildingId) {
      return NextResponse.json({ error: 'Accès non autorisé pour cet immeuble' }, { status: 403 })
    }

    await db.apartment.delete({ where: { id } })
    return NextResponse.json({ message: 'Appartement supprimé avec succès' })
  } catch (error) {
    console.error('Apartments DELETE error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
