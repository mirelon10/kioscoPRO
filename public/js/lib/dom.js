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
