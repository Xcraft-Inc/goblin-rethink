module.exports = `

//////////////////////////////////////////
// THIS SCRIPT RUN IN A DEDICATED JS VM
// Available in scope:
// con	 rethinkdb connection object
// r	   rethinkdb r query object
// print output info in the Goblin Editor
// payload user provided payload object
// 
// Author:
// Version: 


//////////////////////////////////////
// Extraction Step
// write your main query here
// you must return a cursor of rows!
// 
//////////////////////////////////////
function* extract(next){
  //TODO: change db with correct name, write a query
  const q = r.db('<replace-me>').table('<replace-me>');
  return yield q.run(con, next);
}

//////////////////////////////////////
// Transform Step
// here you can:
// - make calculation
// - format values
//////////////////////////////////////
function* transform(row) {
  return row;
}


//////////////////////////////////////
// Load Step (output)
//
// csv	 create CSV output
// json	 create JSON output
// 
// files is created in {exports_folder}/ETL/
//////////////////////////////////////

//const output1 = csv('output1.csv');

function* load(row) {
  print(row);
  //yield output1.insert(row);
}
`;
