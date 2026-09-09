/**
 * State machine ของรายการจัดซื้อจัดจ้าง (ข้อ 5.1, FR-APR-005)
 *
 * ตารางนี้เป็นแหล่งความจริงเดียวว่าสถานะใดไปสถานะใดได้
 * server operation ทุกตัวต้องเรียก assertTransitionAllowed ก่อนเขียนฐานข้อมูล
 * ห้ามให้หน้าจอเป็นผู้ตัดสินใจว่าปุ่มไหนกดได้ (ข้อ 4.2)
 */
import type { PermissionCode } from '@/domain/auth/permissions';

export const PROCUREMENT_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'NEEDS_REVISION',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

export const PROCUREMENT_ACTIONS = [
  'submit',
  'review_pass',
  'review_return',
  'approve',
  'approve_return',
  'reject',
  'issue',
  'receive_partial',
  'receive_all',
  'cancel',
] as const;

export type ProcurementAction = (typeof PROCUREMENT_ACTIONS)[number];

export interface TransitionRule {
  from: ProcurementStatus;
  to: ProcurementStatus;
  permission: PermissionCode;
  /** การส่งกลับ ปฏิเสธ และยกเลิก ต้องมีเหตุผลเสมอ (ข้อ 5.1) */
  requiresReason: boolean;
}

export const TRANSITIONS: Readonly<Record<ProcurementAction, readonly TransitionRule[]>> = {
  submit: [
    {
      from: 'DRAFT',
      to: 'PENDING_REVIEW',
      permission: 'procurement.submit',
      requiresReason: false,
    },
    {
      from: 'NEEDS_REVISION',
      to: 'PENDING_REVIEW',
      permission: 'procurement.submit',
      requiresReason: false,
    },
  ],
  review_pass: [
    {
      from: 'PENDING_REVIEW',
      to: 'PENDING_APPROVAL',
      permission: 'procurement.review',
      requiresReason: false,
    },
  ],
  review_return: [
    {
      from: 'PENDING_REVIEW',
      to: 'NEEDS_REVISION',
      permission: 'procurement.review',
      requiresReason: true,
    },
  ],
  approve: [
    {
      from: 'PENDING_APPROVAL',
      to: 'APPROVED',
      permission: 'procurement.approve',
      requiresReason: false,
    },
  ],
  approve_return: [
    {
      from: 'PENDING_APPROVAL',
      to: 'NEEDS_REVISION',
      permission: 'procurement.approve',
      requiresReason: true,
    },
  ],
  reject: [
    {
      from: 'PENDING_APPROVAL',
      to: 'REJECTED',
      permission: 'procurement.approve',
      requiresReason: true,
    },
  ],
  issue: [{ from: 'APPROVED', to: 'ISSUED', permission: 'documents.issue', requiresReason: false }],
  receive_partial: [
    {
      from: 'ISSUED',
      to: 'PARTIALLY_RECEIVED',
      permission: 'inventory.receive',
      requiresReason: false,
    },
    {
      from: 'PARTIALLY_RECEIVED',
      to: 'PARTIALLY_RECEIVED',
      permission: 'inventory.receive',
      requiresReason: false,
    },
  ],
  receive_all: [
    { from: 'ISSUED', to: 'RECEIVED', permission: 'inventory.receive', requiresReason: false },
    {
      from: 'PARTIALLY_RECEIVED',
      to: 'RECEIVED',
      permission: 'inventory.receive',
      requiresReason: false,
    },
  ],
  cancel: [
    { from: 'DRAFT', to: 'CANCELLED', permission: 'procurement.cancel', requiresReason: true },
    {
      from: 'PENDING_REVIEW',
      to: 'CANCELLED',
      permission: 'procurement.cancel',
      requiresReason: true,
    },
    {
      from: 'NEEDS_REVISION',
      to: 'CANCELLED',
      permission: 'procurement.cancel',
      requiresReason: true,
    },
    {
      from: 'PENDING_APPROVAL',
      to: 'CANCELLED',
      permission: 'procurement.cancel',
      requiresReason: true,
    },
    { from: 'APPROVED', to: 'CANCELLED', permission: 'procurement.cancel', requiresReason: true },
    { from: 'ISSUED', to: 'CANCELLED', permission: 'procurement.cancel', requiresReason: true },
    {
      from: 'PARTIALLY_RECEIVED',
      to: 'CANCELLED',
      permission: 'procurement.cancel',
      requiresReason: true,
    },
  ],
};

/** สถานะที่ยังแก้ไขเนื้อหาได้ (ข้อ 5.1) — สถานะอื่นต้องใช้ revision หรือยกเลิก */
export const EDITABLE_STATUSES: readonly ProcurementStatus[] = ['DRAFT', 'NEEDS_REVISION'];

export function isEditableStatus(status: ProcurementStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export function findTransition(
  from: ProcurementStatus,
  action: ProcurementAction,
): TransitionRule | undefined {
  return TRANSITIONS[action].find((rule) => rule.from === from);
}

export class TransitionError extends Error {
  readonly code: 'INVALID_TRANSITION' | 'REASON_REQUIRED' | 'FORBIDDEN';

  constructor(code: TransitionError['code'], message: string) {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
  }
}

export interface TransitionRequest {
  from: ProcurementStatus;
  action: ProcurementAction;
  /** สิทธิ์ที่ผู้ใช้ถืออยู่จริง ณ เวลาที่เรียก */
  permissions: readonly PermissionCode[];
  reason?: string | null;
}

/**
 * ตรวจว่าการเปลี่ยนสถานะทำได้หรือไม่ และคืนสถานะปลายทาง
 *
 * ลำดับการตรวจตั้งใจให้ "สถานะ" มาก่อน "สิทธิ์" เพื่อไม่ให้ข้อความ error
 * เผยว่าผู้ใช้ขาดสิทธิ์ใดในกรณีที่ action นั้นทำไม่ได้อยู่แล้ว
 */
export function assertTransitionAllowed(request: TransitionRequest): ProcurementStatus {
  const rule = findTransition(request.from, request.action);

  if (!rule) {
    throw new TransitionError(
      'INVALID_TRANSITION',
      `ไม่สามารถดำเนินการ "${request.action}" กับรายการที่อยู่ในสถานะ ${request.from} ได้`,
    );
  }

  if (!request.permissions.includes(rule.permission)) {
    throw new TransitionError('FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้');
  }

  if (rule.requiresReason && !request.reason?.trim()) {
    throw new TransitionError('REASON_REQUIRED', 'ต้องระบุเหตุผลสำหรับการดำเนินการนี้');
  }

  return rule.to;
}

/**
 * การกระทำที่เจ้าของรายการทำกับรายการของตัวเองไม่ได้ (separation of duties)
 *
 * บังคับเสมอ ไม่ใช่ค่าตั้งที่ปิดได้ — ดู assumptions ข้อ 2.9
 *
 * `cancel` ไม่อยู่ในรายการ เพราะการยกเลิกคำขอของตัวเองไม่ใช่การอนุมัติให้ตัวเอง
 * และไม่ทำให้เงินเคลื่อน การห้ามจะทำให้ผู้ขอที่รู้ตัวว่าขอผิดต้องรบกวนคนอื่นมายกเลิกให้
 *
 * `issue` และการรับของไม่อยู่ในรายการเช่นกัน — เป็นหน้าที่คนละสายกับการอนุมัติ
 * และผูกกับสิทธิ์ของตนเองอยู่แล้ว
 */
export const SELF_ACTION_FORBIDDEN: readonly ProcurementAction[] = [
  'review_pass',
  'review_return',
  'approve',
  'approve_return',
  'reject',
];

export function isSelfActionForbidden(action: ProcurementAction): boolean {
  return SELF_ACTION_FORBIDDEN.includes(action);
}

/**
 * การกระทำที่ผู้ใช้คนนี้กดได้จริงกับรายการนี้
 *
 * ใช้ตัดสินว่าจะแสดงปุ่มใดบ้าง — **เป็นเรื่อง UX เท่านั้น**
 * server ตรวจซ้ำทุกครั้งด้วยกติกาชุดเดียวกัน และเป็นผู้ตัดสิน (ข้อ 4.2)
 * การซ่อนปุ่มไม่ใช่การควบคุมสิทธิ์
 */
export function availableActions(input: {
  status: ProcurementStatus;
  permissions: readonly PermissionCode[];
  isOwner: boolean;
}): ProcurementAction[] {
  return PROCUREMENT_ACTIONS.filter((action) => {
    // การส่งอนุมัติมีเส้นทางของตัวเองที่ตรวจกฎครบชุดก่อน จึงไม่อยู่ในชุดปุ่มนี้
    if (action === 'submit') return false;

    const rule = findTransition(input.status, action);
    if (!rule) return false;
    if (!input.permissions.includes(rule.permission)) return false;
    if (input.isOwner && isSelfActionForbidden(action)) return false;

    return true;
  });
}
