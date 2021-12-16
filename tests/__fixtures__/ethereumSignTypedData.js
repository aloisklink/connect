import commonFixtures from '../../submodules/trezor-common/tests/fixtures/ethereum/sign_typed_data.json';

const commonFixturesTests = commonFixtures.tests.flatMap(({ name, parameters, result }) => {
  const fixture = {
      description: `${name} ${parameters.comment ?? ''}`,
      name,
      params: {
          ...parameters,
          metamaskV4Compatibility: parameters.metamask_v4_compat,
      },
      result: {
          address: result.address,
          signature: result.sig,
      },
  };
  return fixture;
});

const [complexDataFixture] = commonFixturesTests.filter(({name}) => name === "complex_data");

// Make sure we test whether bigint or string numbers works correctly
function intAsString(x) {
  return `${x}`;
}
const testNumberFormats = [BigInt, intAsString].map((makeBigNumber) => {
  const fixture = JSON.parse(JSON.stringify(complexDataFixture));
  fixture.description = `${fixture.description} - ${makeBigNumber.name}`;

  const message = fixture.params.data.message;
  message.from.karma = makeBigNumber(message.from.karma);
  message.from.kids = makeBigNumber(message.from.kids);
  message.to.karma = makeBigNumber(message.to.karma);
  message.to.kids = makeBigNumber(message.to.kids);
  return fixture;
});

export default {
    method: 'ethereumSignTypedData',
    setup: {
        mnemonic: commonFixtures.setup.mnemonic,
    },
    tests: [...commonFixturesTests, ...testNumberFormats],
};
