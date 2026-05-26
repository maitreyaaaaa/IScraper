const Stripe = require('stripe');

function createBillingWorkflow({ config }) {
  function stripeFor() {
    return config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
  }

  return {
    stripeFor,
  };
}

module.exports = {
  createBillingWorkflow,
};
