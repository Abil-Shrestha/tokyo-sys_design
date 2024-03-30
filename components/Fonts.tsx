import Card from "./Card";
const Fonts = () => {
  const jpn = [
    {
      cn: "font-array bg-gradient-to-b rounded-md from-[#c8d5bb] to [#47585c]",
      text: "Sabi nezu",
    },
    {
      cn: "font-pramukh bg-gradient-to-b rounded-md from-[#80989b] to [#d4dcda]",
      text: "Usuku mo nezu",
    },
    {
      cn: "font-melodrama bg-gradient-to-b rounded-md from-[#4d80e6] to [#e5e4e6]",
      text: "Nezuogusa",
    },
    {
      cn: "font-sligoil bg-gradient-to-b from-[#4d80e6] to [#e5e4e6] ",
      text: "Yanagi nezumi ",
    },
  ];
  return (
    <div className="w-full bg-black flex flex-col items-center justify-center overflow-hidden rounded-md">
      <h1 className="md:text-4xl text-3xl lg:text-7xl font-bold text-center font-milkman bg-clip-text text-transparent bg-gradient-to-r from-[#c8d5bb] to-[#c8d5bb] animate-gradient-x relative z-20">
        FONTS & GRADIENTS
      </h1>
      <div className="w-[65rem] h-40 relative items-center flex justify-center">
        {/* Gradients */}
        <div className="absolute inset-x-50 top-0 bg-gradient-to-r from-transparent via-[#c8d5bb] to-transparent h-[2px] w-3/4 blur-sm animated-gradient-left-to-right" />
        <div className="absolute inset-x-50 top-0 bg-gradient-to-r from-transparent via-[#c8d5bb] to-transparent h-px w-3/4 animated-gradient-left-to-right" />
        <div className="absolute inset-x-60 top-0 bg-gradient-to-r from-transparent rounded-lg via-[#c8d5bb] to-transparent h-[5px] w-2/4 blur-sm animated-gradient-right-to-left" />
        <div className="absolute inset-x-60 top-0 bg-gradient-to-r from-transparent rounded-lg via-[#c8d5bb] to-transparent h-px w-2/4 animated-gradient-right-to-left" />
      </div>
      <div className="flex flex-row gap-4 pb-12 ">
        {jpn.map((item) => {
          return <Card cn={item.cn} key={item.text} text={item.text} />;
        })}
      </div>
    </div>
  );
};

export default Fonts;
