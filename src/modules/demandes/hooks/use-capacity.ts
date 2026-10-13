import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchCapacityBoard, setNewClientPlaces } from '../api/capacity'
import { demandesKeys } from './keys'

/** Professionnels' query root (`professionalKeys.all`): a module never imports another's hooks. */
const PROFESSIONALS_ROOT = ['professionals'] as const

/** The availability board (D5). */
export function useCapacityBoard() {
  return useQuery({ queryKey: demandesKeys.capacity(), queryFn: fetchCapacityBoard })
}

/**
 * Her places offered: the board, every matching panel (places left) and Professionnels' cached
 * record and lists (their root key, `['professionals']`, documented in its keys.ts) read again.
 */
export function useSetNewClientPlaces() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ professionalId, places, restart }: { professionalId: string; places: number | null; restart: boolean }) =>
      setNewClientPlaces(professionalId, places, restart),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: demandesKeys.all }),
        queryClient.invalidateQueries({ queryKey: PROFESSIONALS_ROOT }),
      ]),
  })
}
