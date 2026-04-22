import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../apiService';

export const sessionKeys = {
  all: ['sessions'] as const,
  slides: (sessionId: string) => ['sessions', sessionId, 'slides'] as const,
  scorecard: (sessionId: string) => ['sessions', sessionId, 'scorecard'] as const,
  slideAnalysis: (sessionId: string, slideIndex: number) =>
    ['sessions', sessionId, 'slide-analysis', slideIndex] as const,
  evidence: (sessionId: string) => ['sessions', sessionId, 'evidence'] as const,
};

export const useSlides = (sessionId: string | null) =>
  useQuery({
    queryKey: sessionId ? sessionKeys.slides(sessionId) : ['sessions', 'slides', 'disabled'],
    queryFn: () => apiService.getSlides(sessionId as string),
    enabled: Boolean(sessionId),
  });

export const useScorecard = (sessionId: string | null) =>
  useQuery({
    queryKey: sessionId
      ? sessionKeys.scorecard(sessionId)
      : ['sessions', 'scorecard', 'disabled'],
    queryFn: () => apiService.getScorecard(sessionId as string),
    enabled: Boolean(sessionId),
  });

export const useSlideAnalysis = (sessionId: string | null, slideIndex: number) =>
  useQuery({
    queryKey: sessionId
      ? sessionKeys.slideAnalysis(sessionId, slideIndex)
      : ['sessions', 'slide-analysis', 'disabled', slideIndex],
    queryFn: () => apiService.getSlideAnalysis(sessionId as string, slideIndex),
    enabled: Boolean(sessionId) && Number.isFinite(slideIndex),
  });

export const useSessionEvidence = (sessionId: string | null) =>
  useQuery({
    queryKey: sessionId
      ? sessionKeys.evidence(sessionId)
      : ['sessions', 'evidence', 'disabled'],
    queryFn: () => apiService.getSessionEvidence(sessionId as string),
    enabled: Boolean(sessionId),
  });

export const useUploadDeck = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, file }: { sessionId: string; file: File }) =>
      apiService.uploadDeck(sessionId, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.slides(variables.sessionId) });
      queryClient.invalidateQueries({ queryKey: sessionKeys.scorecard(variables.sessionId) });
    },
  });
};
