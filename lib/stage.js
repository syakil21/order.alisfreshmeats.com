// One place that turns raw payment/delivery status into what customers and staff see.
// board: which column the order sits in on the staff home page (preparing → ready → done).
const lalamove = require('./lalamove');

function stage(order) {
  const pay = order.payment?.status;
  const d = order.delivery || {};
  const prep = order.prep || {};
  if (pay === 'failed') return { key: 'payment_failed', text: 'Payment not completed', problem: false, board: 'unpaid' };
  if (pay !== 'paid') return { key: 'awaiting_payment', text: 'Waiting for payment', problem: false, board: 'unpaid' };
  if (order.cancelledAt) return { key: 'cancelled', text: 'Cancelled', problem: false, board: 'done' };

  if (order.fulfilment === 'pickup') {
    if (prep.collectedAt) return { key: 'collected', text: 'Collected', problem: false, board: 'done' };
    if (prep.readyAt) return { key: 'ready', text: 'Ready for collection', problem: false, board: 'ready' };
    return { key: 'preparing', text: 'Preparing your order', problem: false, board: 'preparing' };
  }

  if (d.status === 'COMPLETED') return { key: 'delivered', text: 'Delivered', problem: false, board: 'done' };
  if (d.status === 'PICKED_UP') return { key: 'on_the_way', text: 'On the way', problem: false, board: 'ready' };
  if (d.status === 'ON_GOING') return { key: 'driver_assigned', text: 'Driver assigned', problem: false, board: 'preparing' };
  if (d.status === 'ASSIGNING_DRIVER') return { key: 'finding_driver', text: 'Preparing · finding a driver', problem: false, board: 'preparing' };
  if (d.status === 'BOOKING_FAILED') return { key: 'preparing', text: 'Preparing your order', problem: 'Lalamove booking failed', board: 'preparing' };
  if (lalamove.FINAL_FAIL.includes(d.status)) return { key: 'preparing', text: 'Preparing your order', problem: `Lalamove ${d.status.toLowerCase()}: add a tip or rebook`, board: 'preparing' };
  return { key: 'preparing', text: 'Preparing your order', problem: false, board: 'preparing' };
}

module.exports = { stage };
