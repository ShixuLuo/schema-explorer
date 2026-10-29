import type { WorkspaceStore } from "../application/ports.ts";
import { createUseCase } from "../application/workspaces.ts";
import { schemaSpec } from "../model/wire.ts";

// Built-in lesson data; creates a separate model without replacing user data.
export async function createTutorialSample(store: WorkspaceStore) {
  const useCase = await createUseCase(store);
  const staged: import("../model/schema.ts").Table[] = [];
  const writers: import("../application/ports.ts").RowWriter[] = [];
  const customer = crypto.randomUUID(),
    order = crypto.randomUUID();
  const customerId = crypto.randomUUID(),
    customerName = crypto.randomUUID();
  const orderId = crypto.randomUUID(),
    orderCustomer = crypto.randomUUID(),
    total = crypto.randomUUID();
  const definitions = [
    {
      id: customer,
      name: "Customer",
      columns: [
        {
          id: customerId,
          name: "id",
          storage: "identity" as const,
          dataType: "text" as const,
          nullable: false,
          index: 0,
        },
        {
          id: customerName,
          name: "name",
          dataType: "text" as const,
          nullable: false,
          index: 1,
        },
      ],
      primaryKey: [customerId],
      rows: [
        ["C001", "Ada Chen"],
        ["C002", "Lin Park"],
      ],
    },
    {
      id: order,
      name: "Order",
      columns: [
        {
          id: orderId,
          name: "id",
          storage: "identity" as const,
          dataType: "text" as const,
          nullable: false,
          index: 0,
        },
        {
          id: orderCustomer,
          name: "customer_id",
          dataType: "text" as const,
          nullable: false,
          index: 1,
        },
        {
          id: total,
          name: "total_cents",
          dataType: "integer" as const,
          nullable: false,
          index: 2,
        },
      ],
      primaryKey: [orderId],
      rows: [["O101", "C001", "2599"], ["O102", "C002", "1800"], ["O103", "C001", "4200"]],
    },
  ];
  try {
    for (const { rows, ...definition } of definitions) {
      const table = {
        ...definition,
        caseId: useCase.id,
        fileName: "",
        bytes: 0,
        rowCount: 0,
      };
      const writer = store.stage(table);
      writers.push(writer);
      await writer.append(rows);
      staged.push(await writer.finish(table));
    }
    const specs = schemaSpec(staged, []);
    await store.commit(useCase.id, 0, {
      kind: "checkpoint",
      description: "Tutorial sample",
      state: { tables: staged, relationships: [], equations: [] },
      operations: [
        ...specs.tables.map((table) => ({
          op: "create_table" as const,
          table,
        })),
      ],
    });
    await store.patchInfo(useCase.id, { name: "Bookshop · Tutorial" });
    return useCase.id;
  } catch (error) {
    await Promise.allSettled(writers.map((writer) => writer.abort()));
    await store.discard(staged);
    await store.deleteEmpty(useCase.id);
    throw error;
  }
}
