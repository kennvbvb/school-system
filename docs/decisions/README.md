# Architecture Decision Records

บันทึกการตัดสินใจเชิงสถาปัตยกรรมที่มีผลผูกพันต่อโครงการ

รูปแบบ: [MADR](https://adr.github.io/madr/) แบบย่อ — บริบท, ตัวเลือกที่พิจารณา, การตัดสินใจ, ผลที่ตามมา

| #                                            | หัวข้อ                                                     | สถานะ    |
| -------------------------------------------- | ---------------------------------------------------------- | -------- |
| [0001](0001-technology-stack.md)             | Technology stack และการตรึงเวอร์ชัน                        | Accepted |
| [0002](0002-authentication.md)               | Authentication ด้วย Supabase Auth และการปิด public sign-up | Accepted |
| [0003](0003-database-access.md)              | การเข้าถึงฐานข้อมูลและการแบ่งชั้น                          | Accepted |
| [0004](0004-authorization-and-rls.md)        | Authorization สองชั้น: domain service + RLS                | Accepted |
| [0005](0005-money-representation.md)         | การแทนจำนวนเงินด้วยจำนวนเต็มหน่วยสตางค์                    | Accepted |
| [0006](0006-pdf-generation.md)               | การสร้าง PDF ภาษาไทย                                       | Proposed |
| [0007](0007-immutable-document-snapshots.md) | Immutable snapshot ของเอกสารที่ออกแล้ว                     | Accepted |

**สถานะ:**

- `Proposed` — ตัดสินใจแล้วในเชิงทิศทาง แต่ยังไม่ได้พิสูจน์ด้วยโค้ดจริง
- `Accepted` — มีผลบังคับใช้และมีโค้ดรองรับแล้ว
- `Superseded` — ถูกแทนที่โดย ADR ที่ใหม่กว่า (ระบุหมายเลข)
