/* tslint:disable */
/* eslint-disable */

export function build_doc_model_from_bytes(bytes: Uint8Array): any;

export function build_doc_model_from_package(_package: any): string;

export function build_doc_model_from_package_js(_package: any): any;

export function can_preserve_image_paint_source_wasm(image: any, base_package?: any | null, owner_part_name?: string | null): boolean;

export function extract_document_blocks_wasm(model_json: string): string;

export function extract_document_blocks_with_options_wasm(model_json: string, options_json: string): string;

export function extract_document_blocks_with_revisions_wasm(model_json: string): string;

export function extract_document_review_wasm(model_json: string): string;

export function inspect_document_source_wasm(bytes: Uint8Array): string;

export function model_to_document_xml_from_json_wasm(model_json: string, base_package?: any | null): string;

export function model_to_document_xml_wasm(model: any, base_package?: any | null): string;

export function package_to_array_buffer_wasm(_package: any): Uint8Array;

export function parse_docx_wasm(bytes: Uint8Array): any;

export function serialize_docx_from_json_wasm(model_json: string, base_package?: any | null): Uint8Array;

export function serialize_docx_wasm(model: any, base_package?: any | null): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly build_doc_model_from_bytes: (a: number, b: number, c: number) => void;
    readonly build_doc_model_from_package: (a: number, b: number) => void;
    readonly build_doc_model_from_package_js: (a: number, b: number) => void;
    readonly can_preserve_image_paint_source_wasm: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly extract_document_blocks_wasm: (a: number, b: number, c: number) => void;
    readonly extract_document_blocks_with_options_wasm: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly extract_document_blocks_with_revisions_wasm: (a: number, b: number, c: number) => void;
    readonly extract_document_review_wasm: (a: number, b: number, c: number) => void;
    readonly inspect_document_source_wasm: (a: number, b: number, c: number) => void;
    readonly model_to_document_xml_from_json_wasm: (a: number, b: number, c: number, d: number) => void;
    readonly model_to_document_xml_wasm: (a: number, b: number, c: number) => void;
    readonly package_to_array_buffer_wasm: (a: number, b: number) => void;
    readonly parse_docx_wasm: (a: number, b: number, c: number) => void;
    readonly serialize_docx_from_json_wasm: (a: number, b: number, c: number, d: number) => void;
    readonly serialize_docx_wasm: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_247: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export5: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
