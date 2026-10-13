import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchCapacityBoard, setNewClientPlaces } from '../api/capacity'
import { demandesKeys } from './keys'

/** The availability board (D5). */
export function useCapacityBoard() {
  return useQuery({ queryKey: demandesKeys.capacity(), queryFn: fetchCapacityBoard })
}

/** Her places offered: the board and every matching panel (places left) read again. */
export function useSetNewClientPlaces() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ professionalId, places, restart }: { professionalId: string; places: number | null; restart: boolean }) =>
      setNewClientPlaces(professionalId, places, restart),
    onSettled: () => queryClient.invalidateQueries({ queryKey: demandesKeys.all }),
  })
}
