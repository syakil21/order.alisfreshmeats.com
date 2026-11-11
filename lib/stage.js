// One place that turns raw payment/delivery status into what customers and staff see.
// board: which column the order sits in on the staff home page (preparing → ready → done).
const lalamove = require('./lalamove');

function stage(order) {
  const pay = order.payment?.status;
  const d = order.delivery || {};
  const prep = order.prep || {};
  if (pay === 'failed') return { key: 'payment_failed', text: 'Payment not completed', problem: false, board: 'unpaid' };
  // the customer went back and checked out again; this one was never paid
  if (pay === 'replaced') return { key: 'replaced', text: `Not paid, replaced by ${order.replacedBy?.no || 'a newer checkout'}`, problem: false, board: 'replaced' };
  // never paid within the time allowed: closed automatically, nothing to prepare
  if (pay === 'expired') return { key: 'expired', text: 'Not paid: cancelled automatically', problem: false, board: 'unpaid' };
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
  if (lalamove.FINAL_FAIL.includes(d.status)) return { key: 'preparing', text: 'Preparing your order', problem: d.status === 'NOT_FOUND' ? 'Lalamove booking not found: rebook' : `Lalamove ${d.status.toLowerCase()}: rebook`, board: 'preparing' };
  return { key: 'preparing', text: 'Preparing your order', problem: false, board: 'preparing' };
}

module.exports = { stage };
