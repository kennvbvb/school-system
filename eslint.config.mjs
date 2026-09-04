import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  // eslint-config-next 16 ส่งออก flat config array มาโดยตรง ไม่ต้องใช้ FlatCompat
  ...nextCoreWebVitals,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/supabase/admin-client*'],
              message:
                'service-role client ใช้ได้เฉพาะใน src/server เท่านั้น ห้าม import จาก client component',
            },
          ],
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // ไฟล์ฝั่ง server เป็นเจ้าของ admin client จึงยกเว้นกฎห้าม import ให้เฉพาะที่นี่
    files: ['src/server/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettierConfig,
);
