import { useQueryClient } from "@tanstack/react-query";
import {
  useListAllAccounts as useApiListAllAccounts,
  useListAccountsByWallet as useApiListAccountsByWallet,
  useDeriveAccounts as useApiDeriveAccounts,
  useRefreshBalances as useApiRefreshBalances,
  getListAllAccountsQueryKey,
  getListAccountsByWalletQueryKey,
  getListWalletsQueryKey
} from "@workspace/api-client-react";

export function useListAllAccounts() {
  return useApiListAllAccounts();
}

export function useListAccountsByWallet(walletId: number) {
  return useApiListAccountsByWallet(walletId, {
    query: {
      enabled: !!walletId
    }
  });
}

export function useDeriveAccounts() {
  const queryClient = useQueryClient();
  return useApiDeriveAccounts({
    mutation: {
      onSuccess: (_, variables) => {
        queryClient.invalidateQueries({ queryKey: getListAccountsByWalletQueryKey(variables.walletId) });
        queryClient.invalidateQueries({ queryKey: getListAllAccountsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
      }
    }
  });
}

export function useRefreshBalances() {
  const queryClient = useQueryClient();
  return useApiRefreshBalances({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAllAccountsQueryKey() });
      }
    }
  });
}
