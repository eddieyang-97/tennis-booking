// REA 6.8.0's observed interrupted-Playwright-HAR compatibility gap only.
// An unrelated or mixed schema failure must fail the optional experiment.
export function isReceiveTimingRejection(error){
 const issues=error?.code==='invalid_request'?error.details?.issues:null;
 return Array.isArray(issues)&&issues.length>0&&issues.every(issue=>
  Array.isArray(issue?.path)&&issue.path.length===2&&issue.path[0]==='capture_path'&&
  /^\/log\/entries\/\d+\/timings\/receive$/.test(issue.path[1])&&
  issue.reason==='invalid_format'&&
  issue.message==='HAR schema validation failed: minimum (must be >= 0).');
}
