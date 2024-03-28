interface cardProps {
  cn: String;
  text: String;
}
const Card = ({ cn, text }: cardProps) => {
  return (
    <div
      className={`p-20 font-array bg-gradient-to-b hover:scale-125 cursor-pointer rounded-md ${cn}`}
    >
      {text}
    </div>
  );
};

export default Card;
