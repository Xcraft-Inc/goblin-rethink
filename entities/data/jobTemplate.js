module.exports = `
//////////////////////////////////////
// Extraction Step
//
// available in scope:
// con	 rethinkdb connection object
// r	   rethinkdb r query object
// dir	 function like console.dir
//
//////////////////////////////////////
function* extract(next){
  const q = r.db('polypheme').table('customer');
  return yield q.run(con, next);
}

//////////////////////////////////////
// Transform Step
//
// Here you can transform
// print	 print in IDE
//////////////////////////////////////
function* transform(row) {
  row.ok = true;
  return row;
}


//////////////////////////////////////
// Load Step (output)
//
// csv	 create CSV output
//////////////////////////////////////
const output1 = csv('output1.csv');

function* load(row) {
  print(row);
  yield output1.insert(row);
}
`;
