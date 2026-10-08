import type { Database } from '@/core/supabase/database.types'

type Functions = Database['public']['Functions']

/** The generated arguments of an RPC. */
export type RpcArgs<F extends keyof Functions> = Functions[F]['Args']

/**
 * The generator types every uuid and text parameter as non-null, but the module's RPCs take null
 * where SQL allows it: `p_id` on create (every `save_*`), the optional fields of the settings
 * lists (`p_licence_label`, `p_order_id`, `p_min_age`…). This is the one place that cast is made:
 * the keys stay checked against the generated names, each value may be null.
 */
export function sqlArgs<F extends keyof Functions>(args: { [K in keyof RpcArgs<F>]-?: RpcArgs<F>[K] | null }): RpcArgs<F> {
  return args as RpcArgs<F>
}
