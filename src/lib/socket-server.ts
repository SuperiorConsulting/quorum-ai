import { Server as SocketServer } from 'socket.io'
import type { Server as HTTPServer } from 'http'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationEvent {
  leadId: string
  leadName: string
  businessId: string
  channel: 'SMS' | 'EMAIL' | 'VOICE' | 'CHAT'
  direction: 'INBOUND' | 'OUTBOUND'
  message: string
  response?: string
  sentiment: number
  buyingSignal: boolean
  action: string
  timestamp: string
}

export interface LeadUpdatedEvent {
  leadId: string
  businessId: string
  name: string
  score: number
  previousScore: number
  pipelineStage: string
  channel: string
}

export interface DealClosedEvent {
  leadId: string
  businessId: string
  leadName: string
  dealValue: number
  channel: string
  closedAt: string
}

export interface AppointmentBookedEvent {
  leadId: string
  businessId: string
  leadName: string
  appointmentId: string
  appointmentType: string
  scheduledAt: string
}

export interface BriefingReadyEvent {
  businessId: string
  briefingId: string
  stats: {
    revenueClosedOvernite: number
    appointmentsBooked: number
    hotLeadsCount: number
    winBackResponses: number
  }
}

export type QuorumSocketEvent =
  | 'conversation:new'
  | 'lead:updated'
  | 'deal:closed'
  | 'appointment:booked'
  | 'briefing:ready'
  | 'lead:hot'

// ─── Singleton ────────────────────────────────────────────────────────────────

let _io: SocketServer | null = null

/**
 * Initializes the Socket.io server attached to an HTTP server.
 * Called once from the custom Next.js server.
 *
 * @param httpServer - The Node.js HTTP server instance
 */
export function initSocketServer(httpServer: HTTPServer): SocketServer {
  if (_io) return _io

  _io = new SocketServer(httpServer, {
    path: '/api/socket',
    cors: {
      origin: process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  })

  _io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`)

    // Join business-specific room for targeted broadcasts
    socket.on('join:business', (businessId: string) => {
      void socket.join(`business:${businessId}`)
      console.log(`[Socket.io] ${socket.id} joined business:${businessId}`)
    })

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`)
    })
  })

  console.log('[Socket.io] Server initialized on /api/socket')
  return _io
}

/**
 * Returns the Socket.io server instance.
 * Throws if not yet initialized.
 */
export function getIO(): SocketServer {
  if (!_io) throw new Error('Socket.io server not initialized — call initSocketServer first')
  return _io
}

// ─── Emit helpers ─────────────────────────────────────────────────────────────

/**
 * Emits to all clients in a business room.
 * Safe to call even if Socket.io is not initialized (no-op in that case).
 */
function emitToBusinessRoom(
  businessId: string,
  event: QuorumSocketEvent,
  data: unknown,
): void {
  try {
    const io = getIO()
    io.to(`business:${businessId}`).emit(event, data)
  } catch {
    // Socket.io not initialized — fire-and-forget, non-fatal
  }
}

/** Emits a new conversation exchange to the live feed. */
export function emitConversation(data: ConversationEvent): void {
  emitToBusinessRoom(data.businessId, 'conversation:new', data)
}

/** Emits a lead score/stage update to the pipeline panel. */
export function emitLeadUpdated(data: LeadUpdatedEvent): void {
  emitToBusinessRoom(data.businessId, 'lead:updated', data)
  // Also emit hot lead event if score just crossed 80
  if (data.score >= 80 && data.previousScore < 80) {
    emitToBusinessRoom(data.businessId, 'lead:hot', data)
  }
}

/** Emits a deal closed event — triggers the celebration animation. */
export function emitDealClosed(data: DealClosedEvent): void {
  emitToBusinessRoom(data.businessId, 'deal:closed', data)
}

/** Emits when an appointment is booked. */
export function emitAppointmentBooked(data: AppointmentBookedEvent): void {
  emitToBusinessRoom(data.businessId, 'appointment:booked', data)
}

/** Emits when the morning briefing is ready. */
export function emitBriefingReady(data: BriefingReadyEvent): void {
  emitToBusinessRoom(data.businessId, 'briefing:ready', data)
}
