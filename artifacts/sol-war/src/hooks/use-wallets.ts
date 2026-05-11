import { useQueryClient } from "@tanstack/react-query";
import { 
  useListWallets as useApiListWallets,
  useCreateWallets as useApiCreateWallets,
  useDeleteWallet as useApiDeleteWallet,
  getListWalletsQueryKey,
} from "@workspace/api-client-react";

export function useListWallets() {
  return useApiListWallets();
}

export function useCreateWallets() {
  const queryClient = useQueryClient();
  return useApiCreateWallets({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
      }
    }
  });
}

export function useDeleteWallet() {
  const queryClient = useQueryClient();
  return useApiDeleteWallet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
      }
    }
  });
}
