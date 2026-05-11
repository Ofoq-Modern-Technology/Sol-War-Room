import { useQueryClient } from "@tanstack/react-query";
import {
  useExecuteBuy as useApiExecuteBuy,
  useExecuteSell as useApiExecuteSell,
  getPositions,
  getListAllAccountsQueryKey,
  getListTransactionsQueryKey
} from "@workspace/api-client-react";

export function useExecuteBuy() {
  const queryClient = useQueryClient();
  return useApiExecuteBuy({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAllAccountsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      }
    }
  });
}

export function useExecuteSell() {
  const queryClient = useQueryClient();
  return useApiExecuteSell({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAllAccountsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      }
    }
  });
}

export async function fetchPositions(mintAddress: string, accountIds: number[]) {
  return getPositions({ mintAddress, accountIds: accountIds.join(",") });
}
