import https from 'https';

https.get('https://www.yeastgenome.org/backend/locus/S000001855/phenotype_details', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log(Array.isArray(json) ? `Array of length ${json.length}` : `Type: ${typeof json}`);
      if (Array.isArray(json)) {
        console.log(json[0]);
      } else {
        console.log(Object.keys(json));
      }
    } catch (e) {
      console.error('Error parsing JSON:', e);
    }
  });
}).on('error', (e) => {
  console.error(e);
});
