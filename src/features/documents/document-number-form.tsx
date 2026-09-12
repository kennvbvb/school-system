'use client';

import { useMemo, useState } from 'react';
import {
  FormError,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from '@/features/forms/fields';
import { useActionForm } from '@/features/forms/use-action-form';
import {
  DOCUMENT_KINDS,
  DOCUMENT_NUMBER_STATUSES,
  checkDocumentNumberRule,
  requiresReason,
  suggestNextDocumentNumber,
} from '@/domain/documents/document-register';
import { DOCUMENT_KIND_LABELS_TH, DOCUMENT_NUMBER_STATUS_LABELS_TH } from './format';
import type { ActionOutcome } from '@/features/forms/use-action-form';
import type {
  DocumentKind,
  DocumentNumberRecord,
  DocumentNumberStatus,
} from '@/domain/documents/document-register';

/**
 * ฟอร์มบันทึกเลขที่เอกสาร (PR-04b)
 *
 * **โรงเรียนพิมพ์เลขเอง** (Q3) ระบบทำสองอย่างให้เท่านั้น
 *
 *   1. เสนอเลขถัดไปโดยต่อจากรูปแบบที่โรงเรียนใช้อยู่แล้ว — ไม่ได้กรอกให้อัตโนมัติ
 *      แต่มีปุ่มให้เติมลงช่อง ผู้ใช้จึงเห็นว่าตัวเองกำลังยอมรับค่าอะไร
 *      ถ้ายังไม่มีเลขใดในชนิดนี้เลย จะไม่เสนออะไร เพราะระบบไม่รู้รูปแบบของโรงเรียน
 *
 *   2. เตือนเลขซ้ำขณะพิมพ์ ด้วย `checkDocumentNumberRule` **ตัวเดียวกับที่ server
 *      ใช้ปฏิเสธ** — ถ้าคนละตัว จะเกิดกรณีที่ฟอร์มยอมแต่ server ปฏิเสธ
 *      การเตือนที่นี่เป็นเรื่อง UX เท่านั้น ฐานข้อมูลมี unique index เป็นผู้บังคับจริง
 *
 * `existing` มาจาก server แล้วกรองมาเฉพาะขอบเขตความไม่ซ้ำเดียวกัน (ชนิดเอกสาร
 * เดียวกัน ปีงบเดียวกัน) และ **รวมเลขที่ยกเลิกแล้ว** เพราะนำกลับมาใช้ไม่ได้
 */
export function DocumentNumberForm({
  procurementId,
  existing,
  onRecord,
}: {
  procurementId: string;
  existing: readonly DocumentNumberRecord[];
  onRecord: (input: {
    procurementId: string;
    documentKind: DocumentKind;
    status: DocumentNumberStatus;
    documentNo: string;
    issuedDate: string;
    reason: string;
  }) => Promise<ActionOutcome>;
}) {
  const [documentKind, setDocumentKind] = useState<DocumentKind>('REQUEST_MEMO');
  const [status, setStatus] = useState<DocumentNumberStatus>('ISSUED');
  const [documentNo, setDocumentNo] = useState('');
  const [issuedDate, setIssuedDate] = useState('');
  const [reason, setReason] = useState('');

  const form = useActionForm({
    onSuccess: () => {
      setDocumentNo('');
      setIssuedDate('');
      setReason('');
    },
  });

  const suggestion = useMemo(
    () => suggestNextDocumentNumber(existing, documentKind),
    [existing, documentKind],
  );

  /* ตรวจด้วยฟังก์ชันโดเมนตัวเดียวกับที่ server บังคับ — ไม่เขียนกติกาซ้ำที่นี่ */
  const rejection = useMemo(
    () => checkDocumentNumberRule({ documentKind, status, documentNo, reason }, existing),
    [documentKind, status, documentNo, reason, existing],
  );

  /*
   * บล็อกเฉพาะเลขซ้ำ ไม่บล็อกช่องที่ยังกรอกไม่ครบ
   *
   * ปุ่มที่กดไม่ได้ตั้งแต่ฟอร์มยังว่างทำให้ผู้ใช้ไม่รู้ว่าขาดอะไร ส่วนเลขซ้ำเป็นกรณีที่
   * กดไปก็ถูกปฏิเสธแน่นอน จึงกันไว้ก่อนพร้อมบอกเหตุผล
   */
  const duplicate = rejection?.code === 'DOCUMENT_NUMBER_DUPLICATE' ? rejection : null;
  const needsReason = requiresReason(status);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /*
     * ส่งเลขและวันที่ไปเฉพาะเมื่อสถานะเป็น ISSUED
     *
     * ช่องทั้งสองถูกซ่อนเมื่อเลือกสถานะอื่น ถ้ายังส่งค่าที่ค้างอยู่ในสถานะไปด้วย
     * schema จะปฏิเสธว่า "ให้ล้างช่องเลขที่เอกสารก่อน" ทั้งที่ผู้ใช้มองไม่เห็นช่องนั้น
     * แล้วเลย — เป็นข้อความที่แก้ตามไม่ได้
     */
    const issued = status === 'ISSUED';

    await form.submit(() =>
      onRecord({
        procurementId,
        documentKind,
        status,
        documentNo: issued ? documentNo : '',
        issuedDate: issued ? issuedDate : '',
        reason: needsReason ? reason : '',
      }),
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
    >
      <FormError message={form.errorMessage} />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="ชนิดเอกสาร"
          required
          value={documentKind}
          onChange={(value) => setDocumentKind(value as DocumentKind)}
          placeholder="— เลือกชนิดเอกสาร —"
          options={DOCUMENT_KINDS.map((kind) => ({
            id: kind,
            label: DOCUMENT_KIND_LABELS_TH[kind],
          }))}
        />

        <SelectField
          label="สถานะ"
          required
          value={status}
          onChange={(value) => setStatus(value as DocumentNumberStatus)}
          placeholder="— เลือกสถานะ —"
          hint="รายการที่ไม่ต้องมีเลขเอกสารให้เลือก “ไม่ต้องมีเลข” พร้อมเหตุผล แทนการกรอกเลขปลอม"
          /* ยกเลิกทำผ่านปุ่มของแถวที่มีอยู่แล้ว ไม่ใช่สถานะที่สร้างใหม่ได้
             มิฉะนั้นจะมีทางสร้างแถวยกเลิกลอย ๆ เพื่อจองเลขไม่ให้คนอื่นใช้ */
          options={DOCUMENT_NUMBER_STATUSES.filter((value) => value !== 'VOIDED').map((value) => ({
            id: value,
            label: DOCUMENT_NUMBER_STATUS_LABELS_TH[value],
          }))}
        />
      </div>

      {status === 'ISSUED' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <TextField
              label="เลขที่เอกสาร"
              required
              value={documentNo}
              onChange={setDocumentNo}
              error={duplicate?.messageTh}
              hint="กรอกตามที่โรงเรียนใช้จริง ระบบไม่บังคับรูปแบบ แต่กันเลขซ้ำ"
            />

            {suggestion && suggestion !== documentNo ? (
              <p className="text-sm text-slate-600">
                เลขถัดไปจากทะเบียนคือ <span className="font-mono">{suggestion}</span>{' '}
                <button
                  type="button"
                  onClick={() => setDocumentNo(suggestion)}
                  className="font-medium text-slate-900 underline underline-offset-2"
                >
                  ใช้เลขนี้
                </button>
              </p>
            ) : null}
          </div>

          <TextField
            label="วันที่ออกเอกสาร"
            required
            type="date"
            value={issuedDate}
            onChange={setIssuedDate}
          />
        </div>
      ) : null}

      {needsReason ? (
        <TextAreaField
          label="เหตุผล"
          required
          value={reason}
          onChange={setReason}
          hint="ผู้ตรวจสอบจะย้อนกลับมาถามว่าทำไมรายการนี้ไม่มีเลขเอกสาร ระบบบันทึกคำตอบไว้ถาวร"
        />
      ) : null}

      <SubmitButton isSubmitting={form.isSubmitting} disabled={duplicate !== null}>
        บันทึกเลขที่เอกสาร
      </SubmitButton>
    </form>
  );
}
