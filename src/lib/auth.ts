import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'syndic-immeuble-secret-key-2024'
)

export interface AuthPayload {
  userId: string
  email: string
  role: 'ADMIN' | 'BUILDING_ADMIN' | 'OWNER'
  name: string
  isActive: boolean
}

export async function createToken(payload: AuthPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(secret)
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload as unknown as AuthPayload
  } catch {
    return null
  }
}

export async function getSession(): Promise<AuthPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value
  if (!token) return null
  return verifyToken(token)
}

export interface AdminScope {
  isAdmin: boolean
  // null = all buildings (platform ADMIN), otherwise the scoped building
  buildingId: string | null
  buildingName: string | null
  subscriptionActive: boolean
  subscriptionStart: Date | null
  subscriptionEnd: Date | null
}

/**
 * Scope helper for admin-level sessions.
 * - ADMIN (plateforme): access to all buildings, subscription always active.
 * - BUILDING_ADMIN: locked to its building; access only while subscription is valid.
 * Returns null for non-admin roles (OWNER).
 */
export async function getAdminScope(session: AuthPayload): Promise<AdminScope | null> {
  if (session.role === 'ADMIN') {
    return {
      isAdmin: true,
      buildingId: null,
      buildingName: null,
      subscriptionActive: true,
      subscriptionStart: null,
      subscriptionEnd: null,
    }
  }

  if (session.role === 'BUILDING_ADMIN') {
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: {
        buildingId: true,
        building: { select: { name: true } },
        subscriptionStart: true,
        subscriptionEnd: true,
      },
    })
    if (!user) return null

    const now = new Date()
    const start = user.subscriptionStart ? new Date(user.subscriptionStart) : null
    const end = user.subscriptionEnd ? new Date(user.subscriptionEnd) : null
    // Active if subscription has started and not ended (no end date = active)
    const subscriptionActive =
      (!start || start <= now) && (!end || end >= now)

    return {
      isAdmin: true,
      buildingId: user.buildingId,
      buildingName: user.building?.name || null,
      subscriptionActive,
      subscriptionStart: start,
      subscriptionEnd: end,
    }
  }

  return null
}

/**
 * Standard error response when the building admin subscription has expired.
 */
export function subscriptionExpiredResponse() {
  return Response.json(
    { error: 'Votre abonnement a expire. Veuillez renouveler aupres de l\'administrateur.' },
    { status: 403 }
  )
}
