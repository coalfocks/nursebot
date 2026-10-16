import type { ImagingStudy } from './types';

export type NormalizedImagingContrast = {
  contrast: ImagingStudy['contrast'];
  displayOrderName: string;
  warning: string | null;
};

const readContrast = (value: string | null | undefined): ImagingStudy['contrast'] => {
  const text = value?.toLowerCase() ?? '';
  if (/\bwithout\b|\bno\s+contrast\b/.test(text)) return 'without';
  if (/\bwith\b.*\bcontrast\b/.test(text)) return 'with';
  return null;
};

export const normalizeImagingContrast = (study: Pick<ImagingStudy, 'contrast' | 'orderName' | 'report'>): NormalizedImagingContrast => {
  const explicit = study.contrast ?? null;
  const orderText = readContrast(study.orderName);
  const reportText = readContrast(study.report);
  const canonical = explicit ?? orderText ?? reportText;
  const mismatched = [orderText, reportText].some((value) => value && canonical && value !== canonical);
  const label = canonical === 'with' ? 'With contrast' : canonical === 'without' ? 'Without contrast' : null;
  let displayOrderName = study.orderName ?? '';
  if (label && displayOrderName) {
    displayOrderName = displayOrderName
      .replace(/\s*\([^)]*\bcontrast\b[^)]*\)/i, '')
      .replace(/\s+\bwith(?:out)?\b\s+contrast\b/i, '')
      .trim();
    displayOrderName = `${displayOrderName} (${label})`;
  }
  return {
    contrast: canonical,
    displayOrderName,
    warning: mismatched ? 'Legacy contrast metadata disagrees with the normalized contrast. Review manually; stored case data was not changed.' : null,
  };
};
