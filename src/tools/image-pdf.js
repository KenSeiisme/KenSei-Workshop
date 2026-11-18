export function addFittedImage(pdf, embedded) {
  const { width, height } = embedded;
  const page = pdf.addPage(width > height ? [842, 595] : [595, 842]);
  const scale = Math.min(
    (page.getWidth() - 36) / width,
    (page.getHeight() - 36) / height,
  );
  page.drawImage(embedded, {
    x: (page.getWidth() - width * scale) / 2,
    y: (page.getHeight() - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  });
}
