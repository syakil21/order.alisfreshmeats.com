// One place that turns raw payment/delivery status into what customers and staff see.
const lalamove = require('./lalamove');

function stage(order) {
  const pay = order.payment?.status;
  const d = order.delivery || {};
  if (pay === 'failed') return { key: 'payment_failed', text: 'Payment not completed', problem: false };
  if (pay !== 'paid') return { key: 'awaiting_payment', text: 'Waiting for payment', problem: false };
  if (d.status === 'COMPLETED') return { key: 'delivered', text: 'Delivered', problem: false };
  if (d.status === 'PICKED_UP') return { key: 'on_the_way', text: 'On the way', problem: false };
  if (d.status === 'ON_GOING') return { key: 'driver_assigned', text: 'Driver assigned', problem: false };
  if (d.status === 'ASSIGNING_DRIVER') return { key: 'finding_driver', text: 'Preparing · finding a driver', problem: false };
  if (d.status === 'BOOKING_FAILED') return { key: 'preparing', text: 'Preparing your order', problem: 'Lalamove booking failed' };
  if (lalamove.FINAL_FAIL.includes(d.status)) return { key: 'preparing', text: 'Preparing your order', problem: `Lalamove ${d.status.toLowerCase()} — rebook` };
  return { key: 'preparing', text: 'Preparing your order', problem: false };
}

module.exports = { stage };
