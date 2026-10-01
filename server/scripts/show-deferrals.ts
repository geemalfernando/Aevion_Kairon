import { commands, seedOps } from '@core/ops'
const d = seedOps(); commands.closeOrders(d); commands.generatePlan(d)
for (const o of d.orders.filter((o) => o.status === 'DEFERRED').slice(0, 6)) console.log(o.outletId, o.brand, o.temp, '|', o.deferral!.reason, '|', o.deferral!.detail)
