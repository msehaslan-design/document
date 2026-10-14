import { describe, expect, it } from 'vitest';
import { fileNameFromParam } from '../../lib/url-file-name';

describe('fileNameFromParam (?name= for documents opened from ?file=)', () => {
  const url = '/templates/goz-muayene-raporu.docx';

  it('gives a template its Turkish name and keeps the extension', () => {
    expect(fileNameFromParam('Göz muayene raporu.docx', url)).toBe('Göz muayene raporu.docx');
    expect(fileNameFromParam('Göz muayene raporu', url)).toBe('Göz muayene raporu.docx');
    expect(fileNameFromParam('Nöbet çizelgesi.XLSX', '/templates/nobet-cizelgesi.xlsx')).toBe('Nöbet çizelgesi.XLSX');
  });

  it('never lets the name change the document type', () => {
    expect(fileNameFromParam('rapor.pdf', url)).toBe('rapor.pdf.docx');
  });

  it('takes only a bare file name', () => {
    expect(fileNameFromParam('../../etc/Göz raporu.docx', url)).toBe('Göz raporu.docx');
    expect(fileNameFromParam('a\\b\\c.docx', url)).toBe('c.docx');
    expect(fileNameFromParam('a<b>:"c".docx', url)).toBe('abc.docx');
  });

  it('falls back to the URL name when there is nothing usable', () => {
    expect(fileNameFromParam(undefined, url)).toBeUndefined();
    expect(fileNameFromParam('', url)).toBeUndefined();
    expect(fileNameFromParam('   ', url)).toBeUndefined();
    expect(fileNameFromParam('.docx', url)).toBeUndefined();
    expect(fileNameFromParam('Rapor', '/templates/no-extension')).toBeUndefined();
    expect(fileNameFromParam('Rapor', 'http://[bad')).toBeUndefined();
  });
});
