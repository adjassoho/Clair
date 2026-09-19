/**
 * Normalise et convertit les coordonnées d'une sélection utilisateur
 * en un rectangle exploitable par le canvas de recadrage et l'encodeur WebM.
 *
 * @param {Object} selected Coordonnées de la sélection (x, y, width, height, [viewportWidth, viewportHeight])
 * @param {number} videoWidth Largeur réelle du flux vidéo source (tabCapture)
 * @param {number} videoHeight Hauteur réelle du flux vidéo source (tabCapture)
 * @returns {{ x: number, y: number, width: number, height: number }} Rectangle normalisé avec dimensions paires
 */
export function normalizeRect(selected, videoWidth, videoHeight) {
  if (!selected || typeof selected !== 'object') {
    throw new TypeError('La sélection doit être un objet.');
  }

  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) || videoWidth <= 0 || videoHeight <= 0) {
    throw new TypeError('Dimensions de la vidéo source invalides.');
  }

  let { x, y, width, height, viewportWidth, viewportHeight } = selected;

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new TypeError('Les coordonnées de sélection doivent être des nombres finis.');
  }

  // Gestion du tracé inversé (glisser-déposer de droite à gauche ou de bas en haut)
  if (width < 0) {
    x += width;
    width = -width;
  }
  if (height < 0) {
    y += height;
    height = -height;
  }

  // Échelle entre l'interface utilisateur (viewport) et la résolution réelle du flux tabCapture
  let scaleX = 1;
  let scaleY = 1;
  if (Number.isFinite(viewportWidth) && viewportWidth > 0 && Number.isFinite(viewportHeight) && viewportHeight > 0) {
    scaleX = videoWidth / viewportWidth;
    scaleY = videoHeight / viewportHeight;
  }

  let scaledX = Math.round(x * scaleX);
  let scaledY = Math.round(y * scaleY);
  let scaledWidth = Math.round(width * scaleX);
  let scaledHeight = Math.round(height * scaleY);

  // Vérification si la sélection est entièrement en dehors de la surface capturable
  if (scaledX >= videoWidth || scaledY >= videoHeight || (scaledX + scaledWidth) <= 0 || (scaledY + scaledHeight) <= 0) {
    throw new Error('La sélection est en dehors de la surface capturable.');
  }

  // Bornage strict à l'intérieur du flux vidéo
  const boundedX = Math.max(0, Math.min(scaledX, videoWidth - 16));
  const boundedY = Math.max(0, Math.min(scaledY, videoHeight - 16));
  let boundedWidth = Math.min(scaledWidth - (boundedX - scaledX), videoWidth - boundedX);
  let boundedHeight = Math.min(scaledHeight - (boundedY - scaledY), videoHeight - boundedY);

  // Les codecs vidéo (VP8, VP9, H.264) exigent des dimensions paires (modulo 2 = 0)
  boundedWidth = Math.floor(boundedWidth / 2) * 2;
  boundedHeight = Math.floor(boundedHeight / 2) * 2;

  if (boundedWidth < 16 || boundedHeight < 16) {
    throw new Error('La zone sélectionnée est trop petite (minimum 16x16 pixels).');
  }

  return {
    x: boundedX,
    y: boundedY,
    width: boundedWidth,
    height: boundedHeight,
  };
}
