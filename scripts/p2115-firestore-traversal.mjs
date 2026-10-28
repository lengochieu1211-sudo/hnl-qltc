export const isMissingDocument = document =>
  document && typeof document.name === 'string'
  && !document.createTime && !document.updateTime;

export const listDocumentsQuery = cursor => {
  const query = new URLSearchParams({pageSize:'200', showMissing:'true'});
  if (cursor) query.set('pageToken', cursor);
  return query;
};

export async function crawlFirestore({
  listCollections,
  listDocuments,
  documentPath,
  onCollection,
  onDocument,
  parentDocPath = '',
  depth = 0,
  maxDepth = 16,
}) {
  if (depth > maxDepth) throw Error('Nested Firestore depth cap exceeded');
  const ids = await listCollections(parentDocPath);
  for (const col of ids) {
    const relative = (parentDocPath ? parentDocPath + '/' : '') + col;
    await onCollection(relative);
    let cursor = '', page = 0;
    do {
      const response = await listDocuments(relative, cursor);
      for (const document of response.documents || []) {
        const rel = documentPath(document, relative);
        if (!isMissingDocument(document)) await onDocument(document, rel);
        // showMissing placeholders are traversal nodes only. Their children are
        // real data and must still be inventoried, but the placeholder itself
        // must never be counted or restored as a document.
        await crawlFirestore({listCollections, listDocuments, documentPath,
          onCollection, onDocument, parentDocPath: rel, depth: depth + 1, maxDepth});
      }
      cursor = response.nextPageToken || '';
      if (++page > 1000) throw Error('Document pagination exceeded');
    } while (cursor);
  }
}
