(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.EPIcons=factory();})(globalThis,function(){
 const paths={
 dashboard:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
 clients:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',
 candidates:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
 jobs:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12a22 22 0 0 0 18 0m-9 0v3"/>',
 tasks:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-14 4h2m4 0h2m-8 4h2"/>',
 routine:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6m-3 0v3m6 2 2-2"/>',
 commercial:'<path d="m3 17 6-6 4 3 8-10M15 4h6v6M3 21h18"/>',
 notas:'<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M8 16l1-4L19 2l3 3-10 10Z"/>',
 forecast:'<path d="M3 3v18h18M7 16v-4m5 4V8m5 8V5"/>',
 placements:'<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5 9v6m14-6v6"/>',
 goals:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
 pomodoro:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6m-3 0v3"/>',
 reports:'<path d="M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9ZM14 2v7h7M7 13h10M7 17h7"/>',
 fichaje:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 metricas:'<path d="M3 21V3m0 18h18M7 17V9m5 8V5m5 12v-6"/>'
 };
 function svg(name){return '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.jobs)+'</svg>';}
 return {svg};
});
