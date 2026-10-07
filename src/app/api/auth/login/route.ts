import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { createToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email et mot de passe sont requis' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json(
        { error: 'Email ou mot de passe incorrect' },
        { status: 401 }
      )
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Email ou mot de passe incorrect' },
        { status: 401 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Votre compte n\'a pas encore été activé par le syndic. Veuillez patienter.' },
        { status: 403 }
      )
    }

    // Building admin: block access when subscription period is over
    if (user.role === 'BUILDING_ADMIN') {
      const now = new Date()
      const start = user.subscriptionStart ? new Date(user.subscriptionStart) : null
      const end = user.subscriptionEnd ? new Date(user.subscriptionEnd) : null
      const expired = (start && start > now) || (end && end < now)
      if (expired) {
        return NextResponse.json(
          {
            error:
              `Votre abonnement ${end && end < now ? `a expiré le ${end.toLocaleDateString('fr-FR')}` : `débute le ${start?.toLocaleDateString('fr-FR')}`}. ` +
              'Veuillez contacter l\'administrateur pour le renouveler.',
            subscriptionExpired: true,
          },
          { status: 403 }
        )
      }
    }

    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role as 'ADMIN' | 'BUILDING_ADMIN' | 'OWNER',
      name: user.name,
      isActive: user.isActive,
    })

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        buildingId: user.buildingId,
        subscriptionStart: user.subscriptionStart,
        subscriptionEnd: user.subscriptionEnd,
      },
    })

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Erreur lors de la connexion' },
      { status: 500 }
    )
  }
}
