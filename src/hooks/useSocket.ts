'use client'

import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import type {
  ConversationEvent,
  LeadUpdatedEvent,
  DealClosedEvent,
  AppointmentBookedEvent,
  BriefingReadyEvent,
} from '../lib/socket-server.js'

export interface QuorumSocketState {
  connected: boolean
  conversations: ConversationEvent[]
  recentLeadUpdates: LeadUpdatedEvent[]
  recentDeals: DealClosedEvent[]
  recentAppointments: AppointmentBookedEvent[]
  latestBriefing: BriefingReadyEvent | null
  hotLeads: LeadUpdatedEvent[]
}

const MAX_FEED_SIZE = 50

/**
 * React hook that connects to the Quorum Socket.io server and
 * maintains a live state of all dashboard events.
 *
 * @param businessId - Business room to subscribe to
 */
export function useSocket(businessId: string): QuorumSocketState {
  const socketRef = useRef<Socket | null>(null)

  const [connected, setConnected]               = useState(false)
  const [conversations, setConversations]       = useState<ConversationEvent[]>([])
  const [recentLeadUpdates, setLeadUpdates]     = useState<LeadUpdatedEvent[]>([])
  const [recentDeals, setDeals]                 = useState<DealClosedEvent[]>([])
  const [recentAppointments, setAppointments]   = useState<AppointmentBookedEvent[]>([])
  const [latestBriefing, setBriefing]           = useState<BriefingReadyEvent | null>(null)
  const [hotLeads, setHotLeads]                 = useState<LeadUpdatedEvent[]>([])

  useEffect(() => {
    const socketUrl = process.env['NEXT_PUBLIC_SOCKET_URL'] ?? ''

    const socket = io(socketUrl, {
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join:business', businessId)
    })

    socket.on('disconnect', () => setConnected(false))

    socket.on('conversation:new', (data: ConversationEvent) => {
      setConversations((prev) => [data, ...prev].slice(0, MAX_FEED_SIZE))
    })

    socket.on('lead:updated', (data: LeadUpdatedEvent) => {
      setLeadUpdates((prev) => [data, ...prev].slice(0, MAX_FEED_SIZE))
    })

    socket.on('lead:hot', (data: LeadUpdatedEvent) => {
      setHotLeads((prev) => {
        const filtered = prev.filter((l) => l.leadId !== data.leadId)
        return [data, ...filtered].slice(0, 20)
      })
    })

    socket.on('deal:closed', (data: DealClosedEvent) => {
      setDeals((prev) => [data, ...prev].slice(0, MAX_FEED_SIZE))
    })

    socket.on('appointment:booked', (data: AppointmentBookedEvent) => {
      setAppointments((prev) => [data, ...prev].slice(0, MAX_FEED_SIZE))
    })

    socket.on('briefing:ready', (data: BriefingReadyEvent) => {
      setBriefing(data)
    })

    return () => {
      socket.disconnect()
    }
  }, [businessId])

  return {
    connected,
    conversations,
    recentLeadUpdates,
    recentDeals,
    recentAppointments,
    latestBriefing,
    hotLeads,
  }
}
