export function calculate(
  math,
  expression,
  mode = "deg",
  ans = "0",
  variables = {},
) {
  if (!expression.trim() || expression.length > 1000)
    throw Error("Enter an expression of up to 1,000 characters.");
  if (/%\s*[\dA-Za-z.(]/.test(expression))
    throw Error("Use % after a number or parentheses; it means divide by 100.");
  const tree = math.parse(expression.replaceAll("%", "*0.01"));
  let count = 0,
    approx = false;
  const unary = {
    sqrt: math.sqrt,
    cbrt: math.cbrt,
    abs: math.abs,
    ln: math.log,
    log: math.log,
    log10: math.log10,
    exp: math.exp,
    round: math.round,
    floor: math.floor,
    ceil: math.ceil,
  };
  function run(n, depth = 0) {
    if (++count > 200 || depth > 40)
      throw Error("This expression is too complex.");
    if (n.type === "ConstantNode") {
      if (
        typeof n.value !== "number" &&
        typeof n.value !== "string" &&
        !math.isBigNumber(n.value)
      )
        throw Error("Use numeric values.");
      const s = String(n.value);
      if (s.length > 100 || !/^(?:\d*\.?\d+)(?:e[+-]?\d+)?$/i.test(s))
        throw Error("Use a smaller number.");
      const v = math.bignumber(s);
      if (!v.isFinite() || Math.abs(v.e) > 10000)
        throw Error("Number is outside the supported range.");
      return v;
    }
    if (n.type === "ParenthesisNode") return run(n.content, depth + 1);
    if (n.type === "SymbolNode") {
      if (n.name === "ans") return math.bignumber(ans);
      if (n.name === "pi" || n.name === "e") {
        approx = true;
        return math.bignumber(math[n.name]);
      }
      if (Object.hasOwn(variables, n.name))
        return math.bignumber(variables[n.name]);
      throw Error("Use pi, e, ans or a variable defined on this page.");
    }
    const args = (n.args || []).map((x) => run(x, depth + 1));
    let result;
    if (n.type === "OperatorNode") {
      const [a, b] = args;
      if (n.fn === "add") result = math.add(a, b);
      else if (n.fn === "subtract") result = math.subtract(a, b);
      else if (n.fn === "multiply") result = math.multiply(a, b);
      else if (n.fn === "divide") {
        if (b.isZero()) throw Error("Cannot divide by zero.");
        result = math.divide(a, b);
      } else if (n.fn === "unaryMinus") result = math.unaryMinus(a);
      else if (n.fn === "unaryPlus") result = a;
      else if (n.fn === "pow") {
        if (
          Math.abs(b.toNumber()) > 10000 ||
          Math.abs(a.e * b.toNumber()) > 10000
        )
          throw Error("Power is outside the supported range.");
        result = math.pow(a, b);
      } else if (n.fn === "factorial") {
        if (!a.isInteger() || a.lt(0) || a.gt(1000))
          throw Error("Factorial needs an integer from 0 to 1,000.");
        result = math.factorial(a);
      } else throw Error("This operator is not supported.");
    } else if (n.type === "FunctionNode" && n.fn.type === "SymbolNode") {
      const name = n.fn.name;
      if (args.length !== 1) throw Error("Use one value inside this function.");
      if (["sin", "cos", "tan"].includes(name)) {
        approx = true;
        const x =
          mode === "deg"
            ? math.divide(math.multiply(args[0], math.pi), 180)
            : args[0];
        if (name === "tan" && math.abs(math.cos(x)).lt("1e-50"))
          throw Error("Tangent is undefined at this angle.");
        result = math[name](x);
      } else if (["asin", "acos", "atan"].includes(name)) {
        approx = true;
        result = math[name](args[0]);
        if (mode === "deg")
          result = math.divide(math.multiply(result, 180), math.pi);
      } else if (Object.hasOwn(unary, name)) {
        if (["sqrt", "ln", "log", "log10", "exp", "cbrt"].includes(name))
          approx = true;
        result = unary[name](args[0]);
      } else throw Error("This function is not supported.");
    } else throw Error("Only scalar mathematical expressions are supported.");
    if (
      !math.isBigNumber(result) ||
      !result.isFinite() ||
      Math.abs(result.e) > 10000
    )
      throw Error("No finite real result for this expression.");
    return result;
  }
  const value = run(tree),
    text = value.toSignificantDigits(34).toString();
  let fraction = null;
  try {
    const f = math.fraction(value.toNumber());
    if (
      Number.isFinite(value.toNumber()) &&
      Math.abs(f.valueOf() - value.toNumber()) < 1e-14
    )
      fraction = f.toFraction();
  } catch {}
  return {
    text,
    exact: value.toString(),
    fraction,
    approx: approx || !value.eq(math.bignumber(text)),
  };
}
