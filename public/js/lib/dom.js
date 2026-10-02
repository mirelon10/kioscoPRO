export const $ = (id) => document.getElementById(id);

/**
 * Crea un elemento del DOM. Los textos se insertan como texto (nunca como HTML),
 * así un nombre de producto como "<img onerror=...>" no puede ejecutar código (XSS).
 *
 *   h("td", { class: "text-muted" }, producto.nombre)
 */
export function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [clave, valor] of Object.entries(props ?? {})) {
    if (valor == null || valor === false) continue;
    if (clave === "class") el.className = valor;
    else if (clave === "dataset") Object.assign(el.dataset, valor);
    else el.setAttribute(clave, valor === true ? "" : String(valor));
  }
  for (const hijo of hijos.flat()) {
    if (hijo == null || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return el;
}

export const icono = (nombre) => h("i", { class: `fa-solid fa-${nombre}`, "aria-hidden": "true" });

export function mostrar(el, visible) {
  el?.classList.toggle("hidden", !visible);
}

export function filaVacia(tbody, columnas, texto) {
  tbody.replaceChildren(h("tr", {}, h("td", { colspan: columnas, class: "tabla-vacia" }, texto)));
}

/**
 * En celular las tablas se muestran como tarjetas (una por fila) y cada dato lleva el nombre de su
 * columna adelante (CSS: td::before { content: attr(data-label) }). Esto copia el texto del
 * encabezado a cada celda, también cada vez que una tabla se vuelve a dibujar.
 */
export function etiquetarTablasParaCelular(raiz = document) {
  const etiquetar = (tbody) => {
    const titulos = [...(tbody.closest("table")?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent.trim());
    for (const tr of tbody.rows) {
      [...tr.cells].forEach((td, i) => {
        if (td.colSpan > 1) return; // filas de "no hay datos"
        if (titulos[i]) td.dataset.label = titulos[i];
      });
    }
  };
  const tbodies = [...raiz.querySelectorAll("table.table-modern tbody")];
  tbodies.forEach(etiquetar);
  const observador = new MutationObserver((cambios) => {
    for (const c of cambios) etiquetar(c.target.closest("tbody") ?? c.target);
  });
  tbodies.forEach((tbody) => observador.observe(tbody, { childList: true }));
}
