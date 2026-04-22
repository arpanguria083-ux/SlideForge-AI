import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../apiService';
import { sessionKeys } from './sessions';

export const historyKeys = {
  recent: (limit: number) => ['history', 'recent', limit] as const,
};

export const useRecentHistory = (limit = 12) =>
  useQuery({
    queryKey: historyKeys.recent(limit),
    queryFn: () => apiService.getRecentHistory(limit),
  });

export const useOpenHistory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fingerprint: string) => apiService.openHistory(fingerprint),
    onSuccess: (result) => {
      const sessionId = result.session_id;
      queryClient.invalidateQueries({ queryKey: sessionKeys.slides(sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionKeys.scorecard(sessionId) });
    },
  });
};
