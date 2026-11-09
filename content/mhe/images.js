(() => {
  const { MessageType, messaging } = AutoMcGraw;

  const MIN_SIZE = 40;
  const MAX_IMAGES = 4;
  const MAX_EDGE = 1600;
  const LOG_PREFIX = "[Auto-McGraw]";

  function questionImages(container) {
    const seen = new Set();
    return Array.from(container.querySelectorAll("img"))
      .filter((image) => {
        const src = image.currentSrc || image.src;
        if (!src || seen.has(src)) return false;
        // Skip icons; images that haven't loaded yet report 0 and are kept.
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (image.complete && width && height) {
          if (width < MIN_SIZE || height < MIN_SIZE) return false;
        }
        seen.add(src);
        return true;
      })
      .slice(0, MAX_IMAGES);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // The page's own fetch works for same-origin images; the background worker
  // (which has host permissions) covers McGraw Hill CDNs without CORS.
  async function fetchDataUrl(src) {
    if (src.startsWith("data:")) return src;

    try {
      const response = await fetch(src, { credentials: "include" });
      if (response.ok) return await blobToDataUrl(await response.blob());
    } catch {
      // Fall through to the background fetch.
    }

    try {
      const result = await messaging.send({
        type: MessageType.FETCH_IMAGE,
        url: src,
      });
      if (result?.dataUrl) return result.dataUrl;
      if (result?.error) console.warn(LOG_PREFIX, result.error);
    } catch (error) {
      console.warn(LOG_PREFIX, "Image fetch failed:", src, error);
    }
    return null;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image could not be decoded."));
      image.src = dataUrl;
    });
  }

  // Positions of drop zones that sit on top of this image, as 0..1 fractions.
  function markersOver(element, markers) {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return [];

    return markers
      .map(({ element: zone, label }) => {
        const rect = zone.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
          return null;
        }
        return {
          label,
          x: (x - box.left) / box.width,
          y: (y - box.top) / box.height,
        };
      })
      .filter(Boolean);
  }

  function render(image, markers) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const size = Math.max(16, Math.round(canvas.width / 40));
    context.font = `bold ${size}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    markers.forEach(({ label, x, y }) => {
      const cx = x * canvas.width;
      const cy = y * canvas.height;
      const boxWidth = context.measureText(label).width + size;
      context.fillStyle = "#ffeb3b";
      context.strokeStyle = "#000";
      context.lineWidth = 2;
      context.fillRect(cx - boxWidth / 2, cy - size * 0.75, boxWidth, size * 1.5);
      context.strokeRect(
        cx - boxWidth / 2,
        cy - size * 0.75,
        boxWidth,
        size * 1.5
      );
      context.fillStyle = "#000";
      context.fillText(label, cx, cy);
    });

    return canvas.toDataURL("image/png");
  }

  /**
   * Returns the question's images as PNG data URLs, ready to attach in the
   * assistant. `markers` ({ element, label }) are drawn where they overlap an
   * image, so "label the diagram" drop zones show up as numbered boxes.
   */
  async function collect(container, { markers = [] } = {}) {
    const results = [];
    for (const [index, element] of questionImages(container).entries()) {
      const src = element.currentSrc || element.src;
      const dataUrl = await fetchDataUrl(src);
      if (!dataUrl) {
        console.warn(LOG_PREFIX, "Couldn't load question image:", src);
        continue;
      }

      const placed = markersOver(element, markers);
      try {
        results.push({
          dataUrl: render(await loadImage(dataUrl), placed),
          name: `question-image-${index + 1}.png`,
          annotated: placed.length > 0,
        });
      } catch (error) {
        console.warn(LOG_PREFIX, "Couldn't process question image:", error);
      }
    }
    return results;
  }

  AutoMcGraw.images = { collect };
})();
