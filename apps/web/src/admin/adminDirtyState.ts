export function canLeaveAdminEditor(scope: ParentNode = document) {
  if (!(scope instanceof Element && scope.matches('[data-admin-dirty="true"]')) && !scope.querySelector('[data-admin-dirty="true"]')) return true;
  return window.confirm("当前有尚未保存的修改。离开将放弃这些修改，确定继续？");
}
