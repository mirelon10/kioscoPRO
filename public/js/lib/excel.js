import { ErrorNegocio } from "../core/errores.js";

// SheetJS (~950 KB): se descarga recién la primera vez que alguien exporta.
// La integridad (SRI) garantiza que el archivo del CDN no fue modificado.
const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
const SHEETJS_SRI = "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT";

const FORMATO_MONEDA = '"$" #,##0.00;-"$" #,##0.00';
const FORMATO_FECHA = "dd/mm/yyyy hh:mm";

let cargando = null;

function cargarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  cargando ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEETJS_URL;
    script.integrity = SHEETJS_SRI;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => {
      cargando = null;
      script.remove();
      reject(new ErrorNegocio("No se pudo cargar el generador de Excel. Revisá internet y volvé a intentar."));
    };
    document.head.append(script);
  });
  return cargando;
}

/**
 * Genera y descarga un .xlsx.
 *
 * @param {string} nombreArchivo
 * @param {Array<{ nombre: string, filas: any[][], anchos?: number[], columnasMoneda?: number[], filaDesde?: number }>} hojas
 *   filas: matriz de celdas (números, textos o Date). columnasMoneda: índices de columna con formato $.
 *   filaDesde: desde qué fila (0 = primera) se aplica el formato de moneda.
 */
export async function descargarExcel(nombreArchivo, hojas) {
  const XLSX = await cargarSheetJS();
  const libro = XLSX.utils.book_new();

  for (const hoja of hojas) {
    const ws = XLSX.utils.aoa_to_sheet(hoja.filas, { cellDates: true, dateNF: FORMATO_FECHA });
    if (hoja.anchos) ws["!cols"] = hoja.anchos.map((wch) => ({ wch }));

    for (let fila = hoja.filaDesde ?? 0; fila < hoja.filas.length; fila++) {
      for (const columna of hoja.columnasMoneda ?? []) {
        const celda = ws[XLSX.utils.encode_cell({ r: fila, c: columna })];
        if (celda?.t === "n") celda.z = FORMATO_MONEDA;
      }
    }
    XLSX.utils.book_append_sheet(libro, ws, hoja.nombre);
  }

  XLSX.writeFile(libro, nombreArchivo, { compression: true });
}
