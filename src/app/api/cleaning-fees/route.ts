import { NextRequest, NextResponse } from 'next/server'
import { getSession, getAdminScope, subscriptionExpiredResponse } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const buildingId = searchParams.get('buildingId')
    const month = searchParams.get('month')
    const year = searchParams.get('year')

    const where: Record<string, unknown> = {}
    if (month) where.month = parseInt(month)
    if (year) where.year = parseInt(year)

    // Building admin: locked to their own building
    if (session.role === 'BUILDING_ADMIN') {
      const scope = await getAdminScope(session)
      where.buildingId = scope?.buildingId || 'none'
    } else if (buildingId) {
      where.buildingId = buildingId
    }

    const cleaningFees = await db.cleaningFee.findMany({
      where,
      include: { building: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    })

    return NextResponse.json({ cleaningFees })
  } catch (error) {
    console.error('CleaningFees GET error:', error)
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
    const { month, year, amount } = body

    // Building admin: force their own building
    const targetBuildingId = scope.buildingId || body.buildingId
    if (!targetBuildingId || !month || !year || !amount) {
      return NextResponse.json({ error: 'Tous les champs sont requis' }, { status: 400 })
    }

    const cleaningFee = await db.cleaningFee.upsert({
      where: {
        buildingId_month_year: { buildingId: targetBuildingId, month, year },
      },
      create: { buildingId: targetBuildingId, month, year, amount },
      update: { amount },
    })

    return NextResponse.json({ cleaningFee })
  } catch (error) {
    console.error('CleaningFees POST error:', error)
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
    const { id, amount, month, year } = body

    if (!id) {
      return NextResponse.json({ error: 'ID requis' }, { status: 400 })
    }

    const existing = await db.cleaningFee.findUnique({ where: { id } })
    if (scope.buildingId && existing?.buildingId !== scope.buildingId) {
      return NextResponse.json({ error: 'Accès non autorisé pour cet immeuble' }, { status: 403 })
    }

    const data: Record<string, unknown> = {}
    if (amount !== undefined) data.amount = amount
    if (month !== undefined) data.month = month
    if (year !== undefined) data.year = year

    const cleaningFee = await db.cleaningFee.update({
      where: { id },
      data,
      include: { building: true },
    })

    return NextResponse.json({ cleaningFee })
  } catch (error) {
    console.error('CleaningFees PUT error:', error)
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

    const existing = await db.cleaningFee.findUnique({ where: { id } })
    if (scope.buildingId && existing?.buildingId !== scope.buildingId) {
      return NextResponse.json({ error: 'Accès non autorisé pour cet immeuble' }, { status: 403 })
    }

    await db.cleaningFee.delete({ where: { id } })
    return NextResponse.json({ message: 'Frais de ménage supprimé avec succès' })
  } catch (error) {
    console.error('CleaningFees DELETE error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
