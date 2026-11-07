import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  resolveDocumentSectionsFromMetadata,
  sectionBreakPropertiesStartNewPage
} from "./pagination";

function sectionPageNumberOverride(properties?: string): number | undefined {
  const tag = properties?.match(/<w:pgNumType\b[^>]*\/?>/i)?.[0];
  const value = Number(tag?.match(/\bw:start="(\d+)"/i)?.[1]);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function sectionPageParity(properties?: string): number | undefined {
  const type = properties?.match(/<w:type\b[^>]*w:val="([^"]+)"/i)?.[1]?.toLowerCase();
  return type === "evenpage" ? 0 : type === "oddpage" ? 1 : undefined;
}

export function normalizeSectionPageNumber(
  pageNumber: number,
  properties?: string
): number {
  const parity = sectionPageParity(properties);
  return parity !== undefined && pageNumber % 2 !== parity ? pageNumber + 1 : pageNumber;
}

export function createSectionParityBlankPage<T>(): T[] {
  return Object.assign([] as T[], { sectionParityBlank: true });
}

export function isSectionParityBlankPage(page: readonly unknown[]): boolean {
  return (page as readonly unknown[] & { sectionParityBlank?: boolean }).sectionParityBlank === true;
}

export function createSectionPageNumberTracker(metadata: DocModel["metadata"]): {
  advancePage: () => void;
  startSection: (nodeIndex: number, atPageTop: boolean, hasPreviousPages: boolean) => boolean;
} {
  const sections = resolveDocumentSectionsFromMetadata(metadata);
  const starts = new Map(sections.slice(1).map((section) => [section.startNodeIndex, section]));
  let pageNumber = normalizeSectionPageNumber(
    sectionPageNumberOverride(sections[0]?.sectionPropertiesXml) ?? 1,
    sections[0]?.sectionPropertiesXml
  );
  let pendingPageNumber: number | undefined;

  return {
    advancePage() {
      pageNumber = pendingPageNumber ?? pageNumber + 1;
      pendingPageNumber = undefined;
    },
    startSection(nodeIndex, atPageTop, hasPreviousPages) {
      const section = starts.get(nodeIndex);
      if (!section) {
        return false;
      }
      const properties = section.sectionPropertiesXml;
      const override = sectionPageNumberOverride(properties);
      if (properties && !sectionBreakPropertiesStartNewPage(properties)) {
        if (atPageTop) {
          pageNumber = override ?? pageNumber;
          pendingPageNumber = undefined;
        } else {
          pendingPageNumber = override === undefined ? undefined : override + 1;
        }
        return false;
      }
      pendingPageNumber = undefined;
      if (override !== undefined) {
        const normalized = normalizeSectionPageNumber(override, properties);
        const needsBlank = metadata.compatibility?.evenAndOddHeaders === true &&
          atPageTop && hasPreviousPages && normalized % 2 !== pageNumber % 2;
        pageNumber = normalized;
        return needsBlank;
      }
      const normalized = normalizeSectionPageNumber(pageNumber, properties);
      const needsBlank = atPageTop && hasPreviousPages && normalized !== pageNumber;
      if (atPageTop) {
        pageNumber = normalized;
      }
      return needsBlank;
    }
  };
}
