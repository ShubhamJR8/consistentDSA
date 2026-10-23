import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ME_KEY } from '../context/auth-context';
import { leetcodeService } from '../services/leetcode.service';

export function useLeetCodeChallenge() {
  return useMutation({ mutationFn: leetcodeService.createChallenge });
}

export function useVerifyLeetCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: leetcodeService.verify,
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });
}

export function useDisconnectLeetCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: leetcodeService.disconnect,
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });
}
