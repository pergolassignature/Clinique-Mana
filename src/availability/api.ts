import { supabase } from '@/lib/supabaseClient'
import type {
  AvailabilityBlock,
  AvailabilityType,
  Appointment,
  AppointmentStatus,
  AppointmentMode,
  AppointmentClient,
  AppointmentClientRole,
  AppointmentAuditLog,
  CalendarAuditAction,
} from './types'

// =============================================================================
// Database Row Types (snake_case)
// =============================================================================

interface DbAvailabilityBlock {
  id: string
  professional_id: string
  type: AvailabilityType
  label: string | null
  start_time: string
  end_time: string
  allowed_service_ids: string[] | null
  visible_to_clients: boolean
  created_at: string
  updated_at: string
}

interface DbAppointment {
  id: string
  professional_id: string
  service_id: string
  start_time: string
  duration_minutes: number
  status: AppointmentStatus
  mode: AppointmentMode | null
  notes_internal: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  cancellation_fee_applied: boolean | null
  cancellation_fee_percent: number | null
  completed_at: string | null
  rescheduled_from_id: string | null
  created_at: string
  updated_at: string
}

interface DbAppointmentClient {
  id: string
  appointment_id: string
  client_id: string
  role: AppointmentClientRole
  attended: boolean | null
  created_at: string
}

interface DbAppointmentAuditLog {
  id: string
  entity_type: 'appointment' | 'availability_block'
  entity_id: string
  professional_id: string
  actor_id: string | null
  action: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  context: Record<string, unknown> | null
  created_at: string
  actor?: { display_name: string } | null
}

// =============================================================================
// Mappers (DB <-> TypeScript)
// =============================================================================

function mapDbToAvailabilityBlock(row: DbAvailabilityBlock): AvailabilityBlock {
  return {
    id: row.id,
    professionalId: row.professional_id,
    type: row.type,
    label: row.label ?? undefined,
    startTime: row.start_time,
    endTime: row.end_time,
    isRecurring: false, // TODO: Add when recurrence is implemented
    allowedServiceIds: row.allowed_service_ids ?? undefined,
    visibleToClients: row.visible_to_clients,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDbToAppointment(
  row: DbAppointment,
  clientIds: string[] = []
): Appointment {
  return {
    id: row.id,
    professionalId: row.professional_id,
    clientIds,
    serviceId: row.service_id,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    status: row.status,
    mode: row.mode ?? undefined,
    notesInternal: row.notes_internal ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    cancellationReason: row.cancellation_reason ?? undefined,
    cancellationFeeApplied: row.cancellation_fee_applied ?? undefined,
    cancellationFeePercent: row.cancellation_fee_percent ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDbToAppointmentClient(row: DbAppointmentClient): AppointmentClient {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    clientId: row.client_id,
    role: row.role,
    attended: row.attended,
    createdAt: row.created_at,
  }
}

function mapDbToAuditLog(row: DbAppointmentAuditLog): AppointmentAuditLog {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    professionalId: row.professional_id,
    actorId: row.actor_id,
    action: row.action as CalendarAuditAction,
    oldValue: row.old_value,
    newValue: row.new_value,
    context: row.context,
    createdAt: row.created_at,
    actor: row.actor ? { displayName: row.actor.display_name } : null,
  }
}

// =============================================================================
// AVAILABILITY BLOCKS
// =============================================================================

export interface FetchAvailabilityParams {
  professionalId: string
  startDate: string // ISO date (YYYY-MM-DD)
  endDate: string // ISO date (YYYY-MM-DD)
}

export async function fetchAvailabilityBlocks(
  params: FetchAvailabilityParams
): Promise<AvailabilityBlock[]> {
  const { data, error } = await supabase
    .from('availability_blocks')
    .select('*')
    .eq('professional_id', params.professionalId)
    .gte('start_time', `${params.startDate}T00:00:00`)
    .lte('end_time', `${params.endDate}T23:59:59`)
    .order('start_time', { ascending: true })

  if (error) throw error

  return (data || []).map(mapDbToAvailabilityBlock)
}

export async function fetchAvailabilityBlockById(
  id: string
): Promise<AvailabilityBlock | null> {
  const { data, error } = await supabase
    .from('availability_blocks')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }

  return mapDbToAvailabilityBlock(data)
}

export interface CreateAvailabilityBlockInput {
  professionalId: string
  type: AvailabilityType
  label?: string
  startTime: string // ISO datetime
  endTime: string
  allowedServiceIds?: string[]
  visibleToClients?: boolean
}

export async function createAvailabilityBlock(
  input: CreateAvailabilityBlockInput
): Promise<AvailabilityBlock> {
  const { data, error } = await supabase
    .from('availability_blocks')
    .insert({
      professional_id: input.professionalId,
      type: input.type,
      label: input.label ?? null,
      start_time: input.startTime,
      end_time: input.endTime,
      allowed_service_ids: input.allowedServiceIds ?? null,
      visible_to_clients: input.visibleToClients ?? true,
    })
    .select()
    .single()

  if (error) throw error

  return mapDbToAvailabilityBlock(data)
}

export interface UpdateAvailabilityBlockInput {
  type?: AvailabilityType
  label?: string | null
  startTime?: string
  endTime?: string
  allowedServiceIds?: string[] | null
  visibleToClients?: boolean
}

export async function updateAvailabilityBlock(
  id: string,
  input: UpdateAvailabilityBlockInput
): Promise<AvailabilityBlock> {
  const updates: Record<string, unknown> = {}

  if (input.type !== undefined) updates.type = input.type
  if (input.label !== undefined) updates.label = input.label
  if (input.startTime !== undefined) updates.start_time = input.startTime
  if (input.endTime !== undefined) updates.end_time = input.endTime
  if (input.allowedServiceIds !== undefined) updates.allowed_service_ids = input.allowedServiceIds
  if (input.visibleToClients !== undefined) updates.visible_to_clients = input.visibleToClients

  const { data, error } = await supabase
    .from('availability_blocks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  return mapDbToAvailabilityBlock(data)
}

export async function deleteAvailabilityBlock(id: string): Promise<void> {
  const { error } = await supabase
    .from('availability_blocks')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// =============================================================================
// APPOINTMENTS
// =============================================================================

export interface FetchAppointmentsParams {
  professionalId?: string
  startDate: string
  endDate: string
  status?: AppointmentStatus[]
}

export async function fetchAppointments(
  params: FetchAppointmentsParams
): Promise<Appointment[]> {
  let query = supabase
    .from('appointments')
    .select(`
      *,
      clients:appointment_clients(client_id)
    `)
    .gte('start_time', `${params.startDate}T00:00:00`)
    .lte('start_time', `${params.endDate}T23:59:59`)
    .order('start_time', { ascending: true })

  if (params.professionalId) {
    query = query.eq('professional_id', params.professionalId)
  }

  if (params.status && params.status.length > 0) {
    query = query.in('status', params.status)
  }

  const { data, error } = await query

  if (error) throw error

  return (data || []).map((row) => {
    const clients = (row.clients as { client_id: string }[]) || []
    const clientIds = clients.map((c) => c.client_id)
    return mapDbToAppointment(row, clientIds)
  })
}

export async function fetchAppointmentById(
  id: string
): Promise<Appointment | null> {
  const { data, error } = await supabase
    .from('appointments')
    .select(`
      *,
      clients:appointment_clients(client_id)
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  const clients = (data.clients as { client_id: string }[]) || []
  const clientIds = clients.map((c) => c.client_id)
  return mapDbToAppointment(data, clientIds)
}

export interface CreateAppointmentInput {
  professionalId: string
  serviceId: string
  startTime: string
  durationMinutes: number
  clientIds: string[]
  mode?: AppointmentMode
  notesInternal?: string
  status?: AppointmentStatus
}

export async function createAppointment(
  input: CreateAppointmentInput
): Promise<Appointment> {
  // Create appointment
  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .insert({
      professional_id: input.professionalId,
      service_id: input.serviceId,
      start_time: input.startTime,
      duration_minutes: input.durationMinutes,
      mode: input.mode ?? null,
      notes_internal: input.notesInternal ?? null,
      status: input.status ?? 'draft',
    })
    .select()
    .single()

  if (appointmentError) throw appointmentError

  // Add clients
  if (input.clientIds.length > 0) {
    const clientRows = input.clientIds.map((clientId, index) => ({
      appointment_id: appointment.id,
      client_id: clientId,
      role: index === 0 ? 'primary' : 'other',
    }))

    const { error: clientsError } = await supabase
      .from('appointment_clients')
      .insert(clientRows)

    if (clientsError) throw clientsError
  }

  return mapDbToAppointment(appointment, input.clientIds)
}

export interface UpdateAppointmentInput {
  serviceId?: string
  startTime?: string
  durationMinutes?: number
  mode?: AppointmentMode | null
  notesInternal?: string | null
}

export async function updateAppointment(
  id: string,
  input: UpdateAppointmentInput
): Promise<Appointment> {
  const updates: Record<string, unknown> = {}

  if (input.serviceId !== undefined) updates.service_id = input.serviceId
  if (input.startTime !== undefined) updates.start_time = input.startTime
  if (input.durationMinutes !== undefined) updates.duration_minutes = input.durationMinutes
  if (input.mode !== undefined) updates.mode = input.mode
  if (input.notesInternal !== undefined) updates.notes_internal = input.notesInternal

  const { data, error } = await supabase
    .from('appointments')
    .update(updates)
    .eq('id', id)
    .select(`
      *,
      clients:appointment_clients(client_id)
    `)
    .single()

  if (error) throw error

  const clients = (data.clients as { client_id: string }[]) || []
  const clientIds = clients.map((c) => c.client_id)
  return mapDbToAppointment(data, clientIds)
}

export async function confirmAppointment(id: string): Promise<Appointment> {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'confirmed' })
    .eq('id', id)
    .select(`
      *,
      clients:appointment_clients(client_id)
    `)
    .single()

  if (error) throw error

  const clients = (data.clients as { client_id: string }[]) || []
  const clientIds = clients.map((c) => c.client_id)
  return mapDbToAppointment(data, clientIds)
}

export interface CancelAppointmentInput {
  reason?: string
  applyFee?: boolean
  feePercent?: number
}

export async function cancelAppointment(
  id: string,
  input: CancelAppointmentInput = {}
): Promise<Appointment> {
  const { data, error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: input.reason ?? null,
      cancellation_fee_applied: input.applyFee ?? false,
      cancellation_fee_percent: input.feePercent ?? null,
    })
    .eq('id', id)
    .select(`
      *,
      clients:appointment_clients(client_id)
    `)
    .single()

  if (error) throw error

  const clients = (data.clients as { client_id: string }[]) || []
  const clientIds = clients.map((c) => c.client_id)
  return mapDbToAppointment(data, clientIds)
}

export async function completeAppointment(id: string): Promise<Appointment> {
  const { data, error } = await supabase
    .from('appointments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(`
      *,
      clients:appointment_clients(client_id)
    `)
    .single()

  if (error) throw error

  const clients = (data.clients as { client_id: string }[]) || []
  const clientIds = clients.map((c) => c.client_id)
  return mapDbToAppointment(data, clientIds)
}

export async function markNoShow(id: string): Promise<Appointment> {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'no_show' })
    .eq('id', id)
    .select(`
      *,
      clients:appointment_clients(client_id)
    `)
    .single()

  if (error) throw error

  const clients = (data.clients as { client_id: string }[]) || []
  const clientIds = clients.map((c) => c.client_id)
  return mapDbToAppointment(data, clientIds)
}

export async function restoreAppointment(id: string): Promise<Appointment> {
  const { data, error } = await supabase
    .from('appointments')
    .update({
      status: 'draft',
      cancelled_at: null,
      cancellation_reason: null,
      cancellation_fee_applied: null,
      cancellation_fee_percent: null,
    })
    .eq('id', id)
    .select(`
      *,
      clients:appointment_clients(client_id)
    `)
    .single()

  if (error) throw error

  const clients = (data.clients as { client_id: string }[]) || []
  const clientIds = clients.map((c) => c.client_id)
  return mapDbToAppointment(data, clientIds)
}

// =============================================================================
// APPOINTMENT CLIENTS
// =============================================================================

export async function fetchAppointmentClients(
  appointmentId: string
): Promise<AppointmentClient[]> {
  const { data, error } = await supabase
    .from('appointment_clients')
    .select('*')
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data || []).map(mapDbToAppointmentClient)
}

export interface AddClientInput {
  clientId: string
  role?: AppointmentClientRole
}

export async function addClientToAppointment(
  appointmentId: string,
  input: AddClientInput
): Promise<AppointmentClient> {
  const { data, error } = await supabase
    .from('appointment_clients')
    .insert({
      appointment_id: appointmentId,
      client_id: input.clientId,
      role: input.role ?? 'other',
    })
    .select()
    .single()

  if (error) throw error

  return mapDbToAppointmentClient(data)
}

export async function removeClientFromAppointment(
  appointmentId: string,
  clientId: string
): Promise<void> {
  const { error } = await supabase
    .from('appointment_clients')
    .delete()
    .eq('appointment_id', appointmentId)
    .eq('client_id', clientId)

  if (error) throw error
}

export async function updateClientAttendance(
  appointmentId: string,
  clientId: string,
  attended: boolean
): Promise<void> {
  const { error } = await supabase
    .from('appointment_clients')
    .update({ attended })
    .eq('appointment_id', appointmentId)
    .eq('client_id', clientId)

  if (error) throw error
}

// =============================================================================
// CLIENT APPOINTMENTS (for client drawer visits section)
// =============================================================================

export interface ClientAppointmentInfo {
  id: string
  startTime: string
  durationMinutes: number
  status: AppointmentStatus
  serviceName: string
  professionalName: string
}

export async function fetchClientAppointments(
  clientId: string
): Promise<ClientAppointmentInfo[]> {
  // Find all appointments that include this client
  const { data: appointmentClients, error: acError } = await supabase
    .from('appointment_clients')
    .select('appointment_id')
    .eq('client_id', clientId)

  if (acError) throw acError
  if (!appointmentClients || appointmentClients.length === 0) return []

  const appointmentIds = appointmentClients.map(ac => ac.appointment_id)

  // Fetch appointment details with service and professional info
  const { data: appointments, error: aptError } = await supabase
    .from('appointments')
    .select(`
      id,
      start_time,
      duration_minutes,
      status,
      services:service_id (
        name_fr
      ),
      professionals:professional_id (
        profiles:profile_id (
          display_name
        )
      )
    `)
    .in('id', appointmentIds)
    .order('start_time', { ascending: false })

  if (aptError) throw aptError

  return (appointments || []).map(apt => {
    const service = apt.services as unknown as { name_fr: string } | null
    const professional = apt.professionals as unknown as { profiles: { display_name: string } | null } | null
    return {
      id: apt.id,
      startTime: apt.start_time,
      durationMinutes: apt.duration_minutes,
      status: apt.status as AppointmentStatus,
      serviceName: service?.name_fr || 'Service inconnu',
      professionalName: professional?.profiles?.display_name || 'Professionnel inconnu',
    }
  })
}

// =============================================================================
// AUDIT LOG
// =============================================================================

export interface FetchAuditLogParams {
  professionalId?: string
  entityType?: 'appointment' | 'availability_block'
  entityId?: string
  startDate?: string
  endDate?: string
  limit?: number
}

export async function fetchAppointmentAuditLog(
  params: FetchAuditLogParams
): Promise<AppointmentAuditLog[]> {
  let query = supabase
    .from('appointment_audit_log')
    .select(`
      *,
      actor:profiles!appointment_audit_log_actor_id_fkey(display_name)
    `)
    .order('created_at', { ascending: false })

  if (params.professionalId) {
    query = query.eq('professional_id', params.professionalId)
  }

  if (params.entityType) {
    query = query.eq('entity_type', params.entityType)
  }

  if (params.entityId) {
    query = query.eq('entity_id', params.entityId)
  }

  if (params.startDate) {
    query = query.gte('created_at', `${params.startDate}T00:00:00`)
  }

  if (params.endDate) {
    query = query.lte('created_at', `${params.endDate}T23:59:59`)
  }

  if (params.limit) {
    query = query.limit(params.limit)
  }

  const { data, error } = await query

  if (error) throw error

  return (data || []).map(mapDbToAuditLog)
}
