import { createHandler } from './handler.ts'
import { defaultDeps } from '../_shared/deps.ts'

Deno.serve(createHandler(defaultDeps()))
