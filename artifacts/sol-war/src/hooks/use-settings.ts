import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSettings as useApiGetSettings,
  useUpdateSettings as useApiUpdateSettings,
  getGetSettingsQueryKey
} from "@workspace/api-client-react";

export function useGetSettings() {
  return useApiGetSettings();
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useApiUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      }
    }
  });
}
