import { z } from 'zod';

export const queueActionSchema = z.object({
  action: z.enum(['dispatch', 'override', 'move_to_last', 'mark_delayed', 'replace', 'notify_driver']),
  reason: z.string().trim().max(500).optional().default(''),
  newPosition: z.coerce.number().int().min(1).optional(),
}).superRefine((value, context) => {
  if (['move_to_last', 'mark_delayed', 'replace'].includes(value.action) && value.reason.length < 3) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required for this operational override.' });
  }
  if (value.action === 'override' && !value.newPosition) {
    context.addIssue({ code: 'custom', path: ['newPosition'], message: 'Choose the new queue position.' });
  }
});

export const paymentDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional().default(''),
}).superRefine((value, context) => {
  if (value.decision === 'reject' && value.reason.length < 3) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'A rejection reason is required.' });
  }
});
