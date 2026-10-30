export type TutorialContext = {
  draft: boolean;
  editing: boolean;
  busy: boolean;
  migrationOpen: boolean;
  migrationStage: "review" | "configure";
};
export type TutorialStep = {
  id: string;
  title: string;
  body: string;
  target: string;
  targetText?: string;
  presentation?: "workspace";
  fallback?: { selector: string; body: string };
  click?: boolean;
  next?: string;
  ready?: (context: TutorialContext) => boolean;
  appeared?: string;
  disappeared?: string;
  complete?: { selector: string; value?: string; selectedText?: string; absent?: boolean; minCount?: number; textIncludes?: string }[];
};
export type TutorialChapter = { id: string; title: string; steps: TutorialStep[] };
const add = (id: string): TutorialStep => ({id, title: "Add to the canvas", body: "Click **+** to choose what to create.", target: ".floating-add-trigger", click: true});
const menu = (id: string, label: string): TutorialStep => ({id, title: `Choose ${label}`, body: `Click **${label}**.`, target: '.floating-add-menu [role="menuitem"]', targetText: label, click: true});
export const tutorialChapters: TutorialChapter[] = [
  { id: "basics", title: "Basic operations", steps: [
    {id:"story",title:"A bookshop's orders",body:"Two customers placed three orders. We will turn customer_id into a customer reference, then migrate the existing records. First, practice safely in this separate sample.",target: ".react-flow",next:"Start"},
    {id:"data",title:"Inspect the source data",body:"Click **Tables** to see record counts and open the source data.",target:'.view-switch button',targetText:"Tables",click:true},
    {id:"view-data",title:"Open the records",body:"Click the **Customer** card to open its two sample records.",target:'.table-card:has([aria-label="View Customer data"])',click:true},
    {id:"close-data",title:"Two customers, stable IDs",body:"**C001 = Ada Chen; C002 = Lin Park.** Orders use these customer IDs. Click **×** in the data preview to close it.",target:".data-panel",disappeared:".data-panel"},
    {id:"category",title:"Return to the diagram",body:"Click **Category** to edit the same model as objects and arrows.",target:".view-switch button",targetText:"Category",click:true},
    {id:"field",title:"Read an attribute",body:"Click **name**. An arrow to **Text** stores a value; an arrow to another **object** is a reference.",target:'[aria-label="Select arrow Customer.name"]',click:true},
    add("add-object"), menu("object-menu", "Object"),
    {id:"create",title:"Create a practice object",body:"Enter **Shipment**, keep the default primary key **_id**, then click **Create**. The key identifies each shipment record.",target:".object-creator",disappeared:".object-creator"},
    add("add-field"), menu("field-menu", "Arrow"),
    {id:"attribute",title:"Create an attribute",body:"Set **Source = Shipment**, **Arrow name = tracking_code**, and **Target = Text**. Click **Confirm** to store a tracking code for each shipment.",target:".arrow-creator",complete:[{selector:'[aria-label="Select arrow Shipment.tracking_code"]'}]},
    {id:"rename-field",title:"Rename an arrow",body:"Double-click **tracking_code**, enter **tracking_number**, then press **Enter**. Renaming changes the field label while keeping its identity.",target:'.react-flow',complete:[{selector:'[aria-label="Select arrow Shipment.tracking_number"]'}]},
    add("add-reference"), menu("reference-menu", "Arrow"),
    {id:"reference",title:"Create a reference",body:"Set **Source = Shipment**, **Arrow name = order**, and **Target = Order**. Click **Confirm**. An arrow to an object automatically references its primary key, **Order.id**.",target:".arrow-creator",complete:[{selector:'[aria-label="Select arrow Shipment.order"]'}]},
    add("add-customer-field"), menu("customer-field-menu", "Arrow"),
    {id:"customer-field",title:"Store the shipment customer ID",body:"Set **Source = Shipment**, **Arrow name = customer_id**, **Target = Text**, then **Confirm**. Next compare this value with the customer ID reached through its order.",target:".arrow-creator",complete:[{selector:'[aria-label="Select arrow Shipment.customer_id"]'}]},
    {id:"path",title:"Create a path",body:"A **path** chains arrows: **Shipment.order → Order.customer_id** reaches the order's customer ID. **Shipment.customer_id** reaches it directly. Next, select both paths and require them to agree.",target:".react-flow",next:"Create the relation"},
    add("add-relation"), menu("relation-menu", "Relation"),
    {id:"relation-arrows",title:"Select the two paths",body:"Select **Shipment.order**, **Order.customer_id**, and **Shipment.customer_id**. Together they form two paths from Shipment to Text. Leave tracking_number unselected.",target:".react-flow, .relation-composer",complete:[{selector:".relation-occurrences button",textIncludes:"Shipment.order"},{selector:".relation-occurrences button",textIncludes:"Order.customer_id"},{selector:".relation-occurrences button",textIncludes:"Shipment.customer_id"}]},
    {id:"relation-confirm",title:"Require the paths to agree",body:"Click **Confirm** in Relation. The rule is **Shipment.order.customer_id = Shipment.customer_id**. If several equations appear, choose this pair and confirm again.",target:".relation-composer",complete:[{selector:".category-equations .equation-remove"}]},
    {id:"relation-delete",title:"Delete the practice relation",body:"The equation expresses a consistency rule; it does not copy values. Click × beside the equation to remove this practice rule. The arrows remain available.",target:".category-equations",disappeared:".category-equations .equation-remove"},
    {id:"delete-field",title:"Delete an arrow",body:"Hover over **tracking_number**, then click its **×**. Deleting an attribute removes that field from the draft; our source records are still intact.",target:'.react-flow',disappeared:'[aria-label="Delete arrow tracking_number"]'},
    {id:"delete-object",title:"Delete an object",body:"Hover over Shipment and click its ×. Its remaining arrows are removed with it. Review the canvas before continuing.",target:'.react-flow',disappeared:'[aria-label="Delete entity Shipment"]'},
    {id:"reset",title:"Return to the source",body:"Click Rollback if draft changes remain. This discards practice changes. The next chapter works on the original two customers and three orders.",target:'.graph-preview-controls',ready:c=>!c.draft&&!c.editing&&!c.busy},
  ]},
  {id:"suggestions",title:"AI suggestions",steps:[
    {id:"open-ai",title:"Ask about the real data",body:"Click the sparkle button. Suggestions use this sample's schema and data profile. Nothing is requested until you click Generate suggestions.",target:'[aria-label="Show suggestions"]',appeared:".ai-experiment-panel:not([hidden])"},
    {id:"request",title:"Describe the change",body:"Enter: “Link Order.customer_id to Customer.id as customer, preserving all records; rename total_cents to amount_cents.” Then click Generate suggestions.",target:'.ai-experiment-panel:not([hidden])',appeared:'.ai-suggestion-row, .ai-error',next:"Continue manually / skip AI"},
    {id:"review-ai",title:"Review the graph preview",body:"Click a suggestion to focus its graph preview. Use **Hide** to see the whole canvas, then reopen **✧** to review. **✓ accepts; × rejects.** Check **customer → Customer** and **amount_cents**. If one is missing, accept the other and **Suggest again**.",target:'.react-flow, .ai-experiment-panel:not([hidden]), .graph-preview-controls',presentation:"workspace",fallback:{selector:'.ai-experiment-panel .ai-error',body:"AI could not apply this suggestion. **Suggest again** retries. To make a missing reference manually: **Hide**, select **Order.customer_id → Edit arrow**, set **Target = Customer**, **name = customer**, then **Confirm**. The reference targets Customer's primary key automatically. Rename total_cents to amount_cents only if it still remains."},next:"Changes reviewed"},
    {id:"draft-ai",title:"Check the target draft",body:"Accept the **customer reference** and **amount_cents rename**, then click **Hide**. This step continues once both changes are present and all suggestions are reviewed.",target:'.react-flow, .ai-experiment-panel:not([hidden]), .graph-preview-controls',presentation:"workspace",complete:[{selector:'[aria-label="Select arrow Order.customer"]'},{selector:'[aria-label="Select arrow Order.amount_cents"]'},{selector:".ai-suggestion-row",absent:true},{selector:".ai-experiment-panel:not([hidden])",absent:true}]},
  ]},
  {id:"migration",title:"Commit & migrate",steps:[
    {id:"commit",title:"Commit the structural draft",body:"Click **Commit** to review the accepted structural draft. This opens the migration wizard; it has not moved any records yet.",target:'.commit-control .button.primary',ready:c=>c.migrationOpen},
    {id:"review",title:"Review source → target",body:"Check **customer → Customer** and **total_cents → amount_cents** in the before/after diagrams. Click **Continue** to map the existing records.",target:'.migration-review',ready:c=>c.migrationStage==="configure"},
    {id:"parameters",title:"Map the customer reference",body:"The missing decision is **Order.customer_id = Customer.id**. Unchanged fields already carry forward. Leave this match empty to try AI next; the manual alternative is **Source field → Order.customer_id → Use this match**.",target:'.migration-form',next:"Try AI parameters"},
    {id:"open-parameters",title:"AI can help with mappings",body:"Click the sparkle button to open Parameters. You choose whether to request a proposal.",target:'[aria-label="Show parameter suggestions"]',appeared:".migration-ai-panel:not([hidden])"},
    {id:"ai-parameters",title:"Preview, then decide",body:"Leave guidance **blank** and click **Fill parameters**. Use **Hide** to inspect the full mapping form; reopen **✧** to **Accept** or **Reject** the proposal. If no changes are suggested, the mappings are already filled. Hide Parameters before continuing.",target:'.migration-wizard',next:"Mappings reviewed"},
    {id:"migrate",title:"Run when ready",body:"Click **Migrate**. It validates the mappings, moves the records, then saves a **new checkpoint**. If a message names a missing mapping, complete that field and retry.",target:'.migration-wizard > footer',ready:c=>!c.migrationOpen&&!c.draft&&!c.busy},
    {id:"history-open",title:"Open the saved history",body:"Click **History** to see the source checkpoint and the new migration checkpoint.",target:'[aria-label="Open history"]',complete:[{selector:".history-graph .history-event",minCount:2}]},
    {id:"history-overview",title:"Source, migration, and Editing",body:"The linked nodes are real saved checkpoints. The source remains in history; the migration adds a child. Editing marks the checkpoint currently loaded in the editor.",target:".history-graph",next:"Inspect the current checkpoint"},
    {id:"history-current",title:"Inspect the migration checkpoint",body:"Click the checkpoint marked **Editing** to see its saved change and parent checkpoint.",target:'[data-tutorial="editing-checkpoint"]',appeared:'[data-tutorial="checkpoint-details"]'},
    {id:"history-details",title:"Read the checkpoint details",body:"Check **Data migration · 2 tables · 5 rows**, **Parent**, and **Editing · current model**. The migration records a complete result; the source checkpoint remains available.",target:'[data-tutorial="checkpoint-details"]',next:"Check the records"},
    {id:"history-close",title:"Return to the model",body:"Click **×** in History to return to the migrated model.",target:'[aria-label="Close history"]',disappeared:".history-graph"},
    {id:"verify",title:"Inspect the migrated records",body:"Click **Tables**. We will check that both customers and all three orders survived the migration.",target:'.view-switch button',targetText:"Tables",click:true},
    {id:"verify-customers",title:"Check the customers",body:"Click the **Customer** card. It should still show **2 rows**.",target:'.table-card:has([aria-label="View Customer data"])',click:true},
    {id:"verify-customer-data",title:"The customer IDs are unchanged",body:"Confirm **C001 = Ada Chen** and **C002 = Lin Park**. Click **×** in the data preview to inspect orders next.",target:'.data-panel',disappeared:'.data-panel'},
    {id:"verify-orders",title:"Check the orders",body:"Click the **Order** card. It should still show **3 rows**.",target:'.table-card:has([aria-label="View Order data"])',click:true},
    {id:"verify-order-data",title:"References and amounts are preserved",body:"Check **O101 / C001 / 2599**, **O102 / C002 / 1800**, and **O103 / C001 / 4200**. The amount column is now **amount_cents**. Click **×** to finish.",target:'.data-panel',disappeared:'.data-panel'},
    {id:"done",title:"Keep exploring the sample",body:"Revisit any chapter to practice again. After a successful migration, the new checkpoint contains your connected orders. This sample stays separate from your own models.",target:'.react-flow'},
  ]},
];
