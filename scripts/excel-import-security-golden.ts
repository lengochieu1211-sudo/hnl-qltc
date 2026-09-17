import { assertSafeExcelImportFile, MAX_EXCEL_IMPORT_BYTES } from '../src/utils/excelImportUtils';

function expectPass(name: string, size: number) {
  assertSafeExcelImportFile({ name, size });
}

function expectFail(name: string, size: number, expected: RegExp) {
  let message = '';
  try {
    assertSafeExcelImportFile({ name, size });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!expected.test(message)) throw new Error(`Expected ${name} to fail with ${expected}, got: ${message || 'no error'}`);
}

expectPass('Du_Lieu.xlsx', 1024);
expectPass('DU_LIEU.XLS', 4096);
expectFail('du-lieu.csv', 1024, /\.xlsx|\.xls/i);
expectFail('du-lieu.xlsx', 0, /rỗng|không đọc được/i);
expectFail('du-lieu.xlsx', MAX_EXCEL_IMPORT_BYTES + 1, /vượt giới hạn/i);

console.log('EXCEL IMPORT SECURITY GOLDEN PASS');
