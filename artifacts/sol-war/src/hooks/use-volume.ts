import { useQueryClient } from "@tanstack/react-query";
import {
  useStartVolumeJob as useApiStartVolumeJob,
  useListVolumeJobs as useApiListVolumeJobs,
  useStopVolumeJob as useApiStopVolumeJob,
  getListVolumeJobsQueryKey,
  getListTransactionsQueryKey
} from "@workspace/api-client-react";

export function useListVolumeJobs() {
  return useApiListVolumeJobs({
    query: {
      refetchInterval: 5000 // Poll every 5s
    }
  });
}

export function useStartVolumeJob() {
  const queryClient = useQueryClient();
  return useApiStartVolumeJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVolumeJobsQueryKey() });
      }
    }
  });
}

export function useStopVolumeJob() {
  const queryClient = useQueryClient();
  return useApiStopVolumeJob({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVolumeJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      }
    }
  });
}
