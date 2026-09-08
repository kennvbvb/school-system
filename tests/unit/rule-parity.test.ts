import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULE_CODES, isOverridableRule, isRuleCode } from '@/domain/validation/rules';
import type { RuleCode } from '@/domain/validation/rules';

/**
 * กติกา "กฎข้อไหนยกเว้นได้" อยู่สองที่โดยจำเป็น
 *
 *   - `src/domain/validation/rules.ts` — ให้หน้าจอบอกผู้ใช้ล่วงหน้า
 *   - `is_overridable_rule()` ใน migration 0011 — เป็นผู้บังคับจริง
 *
 * สองที่นี้แยกกันไม่ได้ เพราะชั้นโดเมนห้ามพึ่งฐานข้อมูล และฐานข้อมูลต้องบังคับ
 * ได้เองแม้ไม่มีแอป แต่ถ้าทั้งสองไม่ตรงกัน จะเกิดกรณีที่หน้าจอบอกว่า
 * "ยกเว้นได้" แล้ว server ปฏิเสธ ซึ่งผู้ใช้แก้ตามไม่ได้เลย
 *
 * test นี้จึงอ่าน SQL จริงมาเทียบ ไม่ใช่เทียบกับสำเนาที่เขียนไว้ในนี้ —
 * สำเนาจะเก่าเงียบ ๆ พร้อมกับของจริง
 */
const MIGRATION = 'supabase/migrations/20260908000200_procurement_submit.sql';

function overridableRulesInSql(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('create or replace function public.is_overridable_rule');
  expect(start).toBeGreaterThan(-1);

  const body = sql.slice(start, sql.indexOf('$$;', start));
  return [...body.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1] as string);
}

describe('กฎที่ยกเว้นได้ตรงกันระหว่างโดเมนกับฐานข้อมูล', () => {
  it('รายการเหมือนกันทุกข้อ', () => {
    const fromSql = overridableRulesInSql();
    const fromDomain = RULE_CODES.filter((code) => isOverridableRule(code));

    expect([...fromSql].sort()).toEqual([...fromDomain].sort());
  });

  it('ทุกรหัสใน SQL เป็นรหัสที่โดเมนรู้จัก', () => {
    for (const code of overridableRulesInSql()) {
      expect(isRuleCode(code)).toBe(true);
    }
  });

  /*
   * ข้อที่แผนข้อ 7.2 ระบุว่าห้ามยกเว้นเด็ดขาด
   *
   * ล็อกไว้ด้วย test เพราะการเผลอเพิ่มข้อใดข้อหนึ่งเข้าไปในรายการที่ยกเว้นได้
   * จะทำให้ระบบยอมรับเอกสารที่ผิดเลขคณิตหรือผิดปฏิทิน โดยไม่มีอะไรฟ้อง
   */
  it.each<RuleCode>([
    'DATE_INVALID',
    'FUNDING_TOTAL_MISMATCH',
    'FISCAL_YEAR_MISMATCH',
    'REQUIRED_REPORT_FIELD_MISSING',
    'DOCUMENT_NUMBER_DUPLICATE',
  ])('%s ยกเว้นไม่ได้ทั้งสองฝั่ง', (code) => {
    expect(isOverridableRule(code)).toBe(false);
    expect(overridableRulesInSql()).not.toContain(code);
  });
});

describe('รหัสกฎที่ SQL ใช้จริง ต้องเป็นรหัสที่โดเมนรู้จัก', () => {
  it('ไม่มีรหัสที่พิมพ์ผิดใน procurement_check_submit', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const start = sql.indexOf('create or replace function public.procurement_check_submit');
    const body = sql.slice(start, sql.indexOf('return;\nend;\n$$;', start));

    // รหัสกฎใน SQL เขียนเป็น 'CODE'::text เสมอ จึงจับด้วยรูปแบบนี้
    const codes = [...body.matchAll(/'([A-Z][A-Z_]+)'::text/g)].map((match) => match[1] as string);

    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(isRuleCode(code), `${code} ไม่ใช่รหัสกฎที่ประกาศไว้ในโดเมน`).toBe(true);
    }
  });
});
